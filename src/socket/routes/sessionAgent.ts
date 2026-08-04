import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/sessionAgent";
import * as state from "@/agents/sessionAgent/state";
import * as videoGenAgent from "@/agents/videoGenAgent";
import * as actions from "@/agents/sessionAgent/actions";
import ResTool from "@/socket/resTool";
import { wrapSocketForPersistence } from "@/socket/persistingSocket";

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

    const resTool = new ResTool(wrapSocketForPersistence(socket, episodeId), { episodeId });
    let abortController: AbortController | null = null;

    // plan:generate —— 确定性代码，不经过 LLM。选哪些广告素材参与是多选下拉框操作，不适合聊天触发，保留纯按钮
    socket.on("plan:generate", async (data: { adIds: number[] }) => {
      // 先推一条即时确认消息——方案生成要跑多次真实模型调用，不会立刻有结果，
      // 不然点击按钮之后界面上什么反应都没有，用户会以为点击没生效
      const ackMsg = resTool.newMessage("assistant");
      const ackText = ackMsg.text("已收到，正在生成创意方案，请稍候...");
      ackText.complete();
      ackMsg.complete();

      try {
        const plans = await state.startPlanning(episodeId, data.adIds);
        for (const plan of plans) {
          const msg = resTool.newMessage("assistant", "创意总监");
          msg.planCandidate({
            id: plan.id,
            adId: plan.adId,
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

    // plan:approve —— 按钮点击和聊天说"我选方案X"共用 actions.confirmPlanAction
    socket.on("plan:approve", async (data: { planId: number }) => {
      await actions.confirmPlanAction(resTool, episodeId, data.planId);
    });

    // bridgeCut:generate —— 按钮点击和聊天触发共用 actions.generateContentAction
    // imageModelKey/videoModelKey/videoResolution：用户在生成前选的图片/视频模型/分辨率（可选），
    // 只有按钮走的这条路会带，聊天触发走系统默认
    socket.on("bridgeCut:generate", async (data: { creativePlanId: number; imageModelKey?: string; videoModelKey?: string; videoResolution?: string }) => {
      await actions.generateContentAction(resTool, episodeId, data.creativePlanId, data.imageModelKey, data.videoModelKey, data.videoResolution);
    });

    // bridgeCut:retry —— 只有按钮会触发（对已存在失败 cut 的操作，不在"聊天触发下一步"范围内）
    socket.on("bridgeCut:retry", async (data: { bridgeCutId: number }) => {
      try {
        const cut = await u.db("ab_bridgeCut").where("id", data.bridgeCutId).first();
        if (!cut) throw new Error(`bridgeCut ${data.bridgeCutId} 不存在`);
        if (cut.status !== "failed") throw new Error(`bridgeCut ${data.bridgeCutId} 当前状态为 ${cut.status}，不是 failed，无法重试`);

        // video 类型如果已经有确认过的分镜草案图，说明失败发生在 Stage B（成片渲染），只重试 Stage B——
        // 不能直接走 generateCutContent（会重新跑 Stage A，覆盖已确认的草案，还得让用户重新确认一遍分镜）
        const confirmedDraft =
          cut.type === "video"
            ? await u.db("ab_generatedSegment").where("bridgeCutId", data.bridgeCutId).where("stage", "draftImage").where("isSelected", 1).first()
            : null;

        if (confirmedDraft) {
          await u.db("ab_bridgeCut").where("id", data.bridgeCutId).update({ status: "draftConfirmed" });
          const result = await videoGenAgent.renderStageB(data.bridgeCutId);
          const msg = resTool.newMessage("assistant", "桥接视频");
          msg.videoCandidate({
            bridgeCutId: data.bridgeCutId,
            videoUrl: result.videoUrl,
            durationMs: result.durationMs,
            evaluatorScore: result.evaluation.overallScore,
            evaluatorFeedback: result.evaluation.feedback,
          });
          msg.complete();
        } else {
          await actions.generateCutContent(resTool, { id: data.bridgeCutId, index: cut.index!, type: cut.type! });
        }
      } catch (err) {
        const msg = resTool.newMessage("assistant");
        msg.error(u.error(err).message);
      }
    });

    // bridgeCut:confirm —— 按钮点击和聊天触发共用 actions.confirmDraftCutsAction
    socket.on("bridgeCut:confirm", async (data: { creativePlanId: number }) => {
      await actions.confirmDraftCutsAction(resTool, data.creativePlanId);
    });

    // bridgeCut:assemblePlayable —— 按钮点击和聊天触发共用 actions.assemblePlayableAction
    // selectedCandidateFrames：用户在确认弹窗里可选勾选的 Episode 候选素材帧文件名，不选就是空数组
    socket.on("bridgeCut:assemblePlayable", async (data: { creativePlanId: number; selectedCandidateFrames?: string[] }) => {
      await actions.assemblePlayableAction(resTool, data.creativePlanId, data.selectedCandidateFrames ?? []);
    });

    // bridgeCut:customGameGenerate —— 独立入口，不接聊天路由，用户在这个入口里已经明确表达了意图
    socket.on("bridgeCut:customGameGenerate", async (data: { bridgeCutId: number; description: string; selectedCandidateFrames?: string[] }) => {
      await actions.generateCustomGameAction(resTool, data.bridgeCutId, data.description, data.selectedCandidateFrames ?? []);
    });

    // content:confirm —— 按钮点击和聊天触发共用 actions.confirmContentAction
    socket.on("content:confirm", async (data: { creativePlanId: number }) => {
      await actions.confirmContentAction(resTool, episodeId, data.creativePlanId);
    });

    // chat —— 自由文字，交给 LLM 做意图路由（识别"确认/下一步"类意图 + 方案/内容 revise）
    socket.on("chat", async (data: { content: string }) => {
      // 用户在聊天框里自己打的话，前端是本地直接拼进 messages 数组的，从来没经过 resTool/socket
      // 事件这条通路——所以这里单独落一条 message 事件到 ab_chatEvent，只为了以后历史回放时能重建出
      // 用户说过什么，不实时 emit（emit 了会在当前这次会话里造成重复气泡，前端已经本地显示过一次了）
      await u.db("ab_chatEvent").insert({
        episodeId,
        eventType: "message",
        payload: JSON.stringify({
          id: u.uuid(),
          role: "user",
          status: "complete",
          datetime: new Date().toISOString(),
          content: [{ type: "text", data: data.content, status: "complete" }],
        }),
        createTime: Date.now(),
      });

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
          const message = u.error(err).message;
          console.error("[sessionAgent] chat error:", message);
          // runDecisionAI 自己的 catch 已经会在 fullStream 报错时调用 msg.error()，这里是兜底：
          // 万一还有别的异常路径逃过了那层处理（比如 stream() 建立阶段本身就失败），
          // 不能让用户发的消息看起来"完全没反应"，至少要有一条能看到的错误提示
          msg.error(message);
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
