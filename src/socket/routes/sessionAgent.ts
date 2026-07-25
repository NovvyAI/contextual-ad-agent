import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/sessionAgent";
import * as state from "@/agents/sessionAgent/state";
import * as bridgeVideoAgent from "@/agents/bridgeVideoAgent";
import * as playableAgent from "@/agents/playableAgent";
import * as overlayAgent from "@/agents/overlayAgent";
import * as supervisorAgent from "@/agents/supervisorAgent";
import * as assembler from "@/agents/assembler";
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

    // 按 cut 类型派发到对应执行 Agent 并推卡片——bridgeCut:generate 首次生成、bridgeCut:retry 重试失败的 cut 共用
    async function generateCutContent(cut: { id: number; index: number; type: string }) {
      if (cut.type === "video") {
        const result = await bridgeVideoAgent.generateDraftCut(cut.id);
        const msg = resTool.newMessage("assistant", "桥接视频");
        msg.storyboardCut({
          bridgeCutId: cut.id,
          index: cut.index,
          imageUrl: result.imageUrl,
          prompt: result.draft.prompt,
          status: "draft",
          evaluatorScore: result.evaluation.overallScore,
          evaluatorFeedback: result.evaluation.feedback,
        });
        msg.complete();
      } else if (cut.type === "playableGame") {
        const result = await playableAgent.assemblePlayable(cut.id);
        const msg = resTool.newMessage("assistant", "互动游戏");
        msg.contentCandidate({
          bridgeCutId: cut.id,
          type: "playableGame",
          previewUrl: result.previewUrl,
          evaluatorScore: result.evaluation.overallScore,
          evaluatorFeedback: result.evaluation.feedback,
        });
        msg.complete();
      } else if (cut.type === "ctaCard") {
        const result = await overlayAgent.generateOverlay(cut.id);
        const msg = resTool.newMessage("assistant", "CTA 卡片");
        msg.contentCandidate({
          bridgeCutId: cut.id,
          type: "ctaCard",
          previewUrl: result.imageUrl,
          ctaUrl: result.config.ctaUrl,
          evaluatorScore: result.evaluation.overallScore,
          evaluatorFeedback: result.evaluation.feedback,
        });
        msg.complete();
      }
    }

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

    // bridgeCut:generate —— 确定性代码，不经过 LLM。对已批准方案的 formatSequence 并行派发三个执行 Agent
    socket.on("bridgeCut:generate", async (data: { creativePlanId: number }) => {
      try {
        const cuts = await state.createBridgeCuts(episodeId, data.creativePlanId);
        const results = await Promise.allSettled(cuts.map((cut) => generateCutContent(cut)));
        // allSettled 本身不会抛错，失败的 cut 在这里显式记日志+推给用户，避免静默吞掉；cut 状态已由各 Agent 自己的 catch 块置为 failed，可通过 bridgeCut:retry 重试
        results.forEach((result, i) => {
          if (result.status !== "rejected") return;
          const cut = cuts[i];
          console.error(`[sessionAgent] bridgeCut ${cut.id}（type=${cut.type}）生成失败:`, u.error(result.reason).message);
          const msg = resTool.newMessage("assistant");
          msg.error(`cut ${cut.id}（${cut.type}）生成失败：${u.error(result.reason).message}，可点击重试`);
        });
      } catch (err) {
        const msg = resTool.newMessage("assistant");
        msg.error(u.error(err).message);
      }
    });

    // bridgeCut:retry —— 确定性代码，不经过 LLM。对单个 failed 状态的 cut 重新派发生成，不重建 cut 本身
    socket.on("bridgeCut:retry", async (data: { bridgeCutId: number }) => {
      try {
        const cut = await u.db("ab_bridgeCut").where("id", data.bridgeCutId).first();
        if (!cut) throw new Error(`bridgeCut ${data.bridgeCutId} 不存在`);
        if (cut.status !== "failed") throw new Error(`bridgeCut ${data.bridgeCutId} 当前状态为 ${cut.status}，不是 failed，无法重试`);
        await generateCutContent({ id: data.bridgeCutId, index: cut.index!, type: cut.type! });
      } catch (err) {
        const msg = resTool.newMessage("assistant");
        msg.error(u.error(err).message);
      }
    });

    // bridgeCut:confirm —— 确定性代码，不经过 LLM。全部分镜草案确认后触发 Stage B 渲染
    socket.on("bridgeCut:confirm", async (data: { creativePlanId: number }) => {
      const msg = resTool.newMessage("assistant");
      try {
        await bridgeVideoAgent.confirmAllCuts(data.creativePlanId);
        const text = msg.text("已确认全部分镜草案，开始渲染成片。");
        text.complete();
        msg.complete();

        const videoCuts = await u.db("ab_bridgeCut").where("creativePlanId", data.creativePlanId).where("type", "video");
        await Promise.allSettled(
          videoCuts.map(async (cut: any) => {
            const result = await bridgeVideoAgent.renderStageB(cut.id);
            const renderMsg = resTool.newMessage("assistant", "桥接视频");
            renderMsg.videoCandidate({
              bridgeCutId: cut.id,
              videoUrl: result.videoUrl,
              durationMs: result.durationMs,
              evaluatorScore: result.evaluation.overallScore,
              evaluatorFeedback: result.evaluation.feedback,
            });
            renderMsg.complete();
          }),
        );
      } catch (err) {
        msg.error(u.error(err).message);
      }
    });

    // content:confirm —— 确定性代码，不经过 LLM。SupervisorAgent 落地前终审通过才让 Assembler 组装最终交付物
    socket.on("content:confirm", async (data: { creativePlanId: number }) => {
      const msg = resTool.newMessage("assistant");
      try {
        await state.assertContentReady(episodeId, data.creativePlanId);

        const supervision = await supervisorAgent.runSupervision(data.creativePlanId);
        const supervisionMsg = resTool.newMessage("assistant", "终审");
        supervisionMsg.supervisorResult({
          bridgeCutId: supervision.bridgeCutId,
          passed: supervision.passed,
          contentCompliance: supervision.contentCompliance,
          brandSafety: supervision.brandSafety,
          technicalSpec: supervision.technicalSpec,
          issues: supervision.issues,
          feedback: supervision.feedback,
        });
        supervisionMsg.complete();

        if (!supervision.passed) {
          const text = msg.text("落地终审未通过，请根据上面的问题修改内容后重新确认。");
          text.complete();
          msg.complete();
          return;
        }

        const manifestId = await assembler.assemble(episodeId, data.creativePlanId, supervision);
        await state.enterAssembling(episodeId);

        const manifestRow = await u.db("ab_manifest").where("id", manifestId).first();
        const manifestJson = JSON.parse(manifestRow?.manifestJson ?? "{}");
        const manifestMsg = resTool.newMessage("assistant", "落地");
        manifestMsg.manifest({
          manifestId,
          episodeId,
          creativePlanId: data.creativePlanId,
          type: manifestJson.type,
          deliverableUrl: manifestJson.deliverable?.url,
          ctaUrl: manifestJson.assets?.ctaUrl,
        });
        manifestMsg.complete();

        const text = msg.text("已完成落地终审和最终组装。");
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
