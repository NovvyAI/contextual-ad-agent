import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/sessionAgent";
import * as state from "@/agents/sessionAgent/state";
import ResTool from "@/socket/resTool";

async function verifyToken(rawToken: string): Promise<boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[sessionAgent] 连接失败，token 无效");
      socket.disconnect();
      return;
    }
    // 一个 episode 对应一次会话，episodeId 在这里扮演 Toonflow scriptAgent 里 isolationKey 的角色
    const episodeId = Number(socket.handshake.auth.episodeId);
    if (!episodeId) {
      console.log("[sessionAgent] 连接失败，缺少 episodeId");
      socket.disconnect();
      return;
    }

    console.log("[sessionAgent] 已连接:", socket.id, "episodeId:", episodeId);

    const resTool = new ResTool(socket, { episodeId });
    let abortController: AbortController | null = null;

    // plan:generate —— 确定性代码，不经过 LLM
    socket.on("plan:generate", async (data: { adIds: number[] }) => {
      try {
        const plans = await state.startPlanning(episodeId, data.adIds);
        for (const plan of plans) {
          const msg = resTool.newMessage("assistant", "创意总监");
          msg.planCandidate({
            id: plan.id,
            adId: plan.adId,
            formatSequence: plan.formatSequence,
            narrative: plan.narrative,
            tone: plan.tone,
            planEvaluatorScore: plan.planEvaluatorScore,
            status: plan.status,
            evaluatorFeedback: plan.evaluatorFeedback,
          });
          msg.complete();
        }
      } catch (err) {
        const msg = resTool.newMessage("assistant");
        msg.error(u.error(err).message);
      }
    });

    // plan:approve —— 确定性代码，不经过 LLM
    socket.on("plan:approve", async (data: { planId: number }) => {
      const msg = resTool.newMessage("assistant");
      try {
        await state.approvePlan(episodeId, data.planId);
        const text = msg.text(`已确认方案 ${data.planId}，进入内容生成阶段。`);
        text.complete();
        msg.complete();
      } catch (err) {
        msg.error(u.error(err).message);
      }
    });

    // chat —— 自由文字，交给 LLM 做意图路由（唯一的工具是方案 revise）
    socket.on("chat", async (data: { content: string }) => {
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
      const ctx: agent.AgentContext = {
        socket,
        episodeId,
        text: data.content,
        abortSignal: currentController.signal,
        resTool,
        msg,
      };

      try {
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err?.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[sessionAgent] chat error:", u.error(err).message);
        }
      } finally {
        if (abortController === currentController) abortController = null;
      }
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });

  nsp.on("disconnect", (socket: Socket) => {
    console.log("[sessionAgent] 已断开连接:", socket.id);
  });
};
