import u from "@/utils";
import * as state from "@/agents/sessionAgent/state";
import * as videoGenAgent from "@/agents/videoGenAgent";
import * as playableAgent from "@/agents/playableAgent";
import * as supervisorAgent from "@/agents/supervisorAgent";
import * as assembler from "@/agents/assembler";
import ResTool from "@/socket/resTool";

/**
 * 管线里每一步"确认/下一步"动作的共享实现——按钮点击（src/socket/routes/sessionAgent.ts）和
 * 聊天框自由文字触发（src/agents/sessionAgent/index.ts 的 tool calling）两条入口共用同一份逻辑，
 * 避免同样的编排代码写两遍、行为跑偏。每个函数自己兜底 try/catch、自己往 resTool 推消息，
 * 调用方不需要关心成功/失败——真实结果永远是通过消息卡片告诉用户，不是通过函数返回值/抛错。
 */

// 按 cut 类型派发到对应执行 Agent 并推卡片——generateContentAction 首次生成、bridgeCut:retry 重试失败的 cut、
// assemblePlayableAction 手动确认组装小游戏，三处共用
export async function generateCutContent(resTool: ResTool, cut: { id: number; index: number; type: string }): Promise<void> {
  if (cut.type === "video") {
    const result = await videoGenAgent.generateDraftCut(cut.id);
    const msg = resTool.newMessage("assistant", "桥接视频");
    msg.storyboardCut({
      bridgeCutId: cut.id,
      index: cut.index,
      imageUrl: result.imageUrl,
      prompt: result.assembledPrompt,
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
  }
}

/** 确认某一份创意方案——按钮点击 plan:approve、聊天说"我选方案1"共用 */
export async function confirmPlanAction(resTool: ResTool, episodeId: number, planId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    await state.approvePlan(episodeId, planId);
    const text = msg.text(`已确认方案 ${planId}，进入内容生成阶段。`);
    text.complete();
    msg.complete();
  } catch (err) {
    msg.error(u.error(err).message);
  }
}

/** 为已确认方案生成内容（固定两段式：只生成 video 段草案，playableGame 段留给 assemblePlayableAction） */
export async function generateContentAction(resTool: ResTool, episodeId: number, creativePlanId: number): Promise<void> {
  try {
    const cuts = await state.createBridgeCuts(episodeId, creativePlanId);
    const videoCuts = cuts.filter((cut) => cut.type === "video");
    const results = await Promise.allSettled(videoCuts.map((cut) => generateCutContent(resTool, cut)));
    results.forEach((result, i) => {
      if (result.status !== "rejected") return;
      const cut = videoCuts[i];
      console.error(`[sessionAgent] bridgeCut ${cut.id}（type=${cut.type}）生成失败:`, u.error(result.reason).message);
      const msg = resTool.newMessage("assistant");
      msg.error(`cut ${cut.id}（${cut.type}）生成失败：${u.error(result.reason).message}，可点击重试`);
    });
  } catch (err) {
    const msg = resTool.newMessage("assistant");
    msg.error(u.error(err).message);
  }
}

/** 确认全部分镜草案，渲染 Stage B 成片 */
export async function confirmDraftCutsAction(resTool: ResTool, creativePlanId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    await videoGenAgent.confirmAllCuts(creativePlanId);
    const text = msg.text("已确认全部分镜草案，开始渲染成片。");
    text.complete();
    msg.complete();

    const videoCuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId).where("type", "video");
    const results = await Promise.allSettled(
      videoCuts.map(async (cut: any) => {
        const result = await videoGenAgent.renderStageB(cut.id);
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
    // allSettled 不会抛错，Stage B 渲染失败必须显式记日志+推给用户，否则前端会一直卡在"内容生成中..."
    results.forEach((result, i) => {
      if (result.status !== "rejected") return;
      const cut = videoCuts[i];
      console.error(`[sessionAgent] bridgeCut ${cut.id} 成片渲染失败:`, u.error(result.reason).message);
      const errMsg = resTool.newMessage("assistant");
      errMsg.error(`cut ${cut.id}（成片渲染）失败：${u.error(result.reason).message}，可点击重试`);
    });
  } catch (err) {
    msg.error(u.error(err).message);
  }
}

/** M7 新增的手动确认点：video 段成片渲染完之后，不自动直通，等用户主动确认才组装小游戏 */
export async function assemblePlayableAction(resTool: ResTool, creativePlanId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
    const videoCut = cuts.find((c: any) => c.type === "video");
    const gameCut = cuts.find((c: any) => c.type === "playableGame");
    if (!videoCut) throw new Error(`创意方案 ${creativePlanId} 缺少 video cut`);
    if (videoCut.status !== "done") throw new Error(`桥接视频 cut ${videoCut.id} 当前状态是 ${videoCut.status}，还没渲染完成，不能组装小游戏`);
    if (!gameCut || gameCut.id == null) throw new Error(`创意方案 ${creativePlanId} 缺少 playableGame cut`);
    if (gameCut.status !== "pending") throw new Error(`小游戏 cut ${gameCut.id} 当前状态是 ${gameCut.status}，不是 pending，不能重复组装`);

    const text = msg.text("已确认组装小游戏，开始生成。");
    text.complete();
    msg.complete();

    try {
      await generateCutContent(resTool, { id: gameCut.id, index: gameCut.index ?? 0, type: "playableGame" });
    } catch (genErr) {
      console.error(`[sessionAgent] bridgeCut ${gameCut.id}（playableGame）组装失败:`, u.error(genErr).message);
      const errMsg = resTool.newMessage("assistant");
      errMsg.error(`小游戏组装失败：${u.error(genErr).message}，可点击重试`);
    }
  } catch (err) {
    msg.error(u.error(err).message);
  }
}

/** 落地前终审 + 落地组装 */
export async function confirmContentAction(resTool: ResTool, episodeId: number, creativePlanId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    await state.assertContentReady(episodeId, creativePlanId);

    const supervision = await supervisorAgent.runSupervision(creativePlanId);
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

    const manifestId = await assembler.assemble(episodeId, creativePlanId, supervision);
    await state.enterAssembling(episodeId);

    const manifestRow = await u.db("ab_manifest").where("id", manifestId).first();
    const manifestJson = JSON.parse(manifestRow?.manifestJson ?? "{}");
    const manifestMsg = resTool.newMessage("assistant", "落地");
    manifestMsg.manifest({
      manifestId,
      episodeId,
      creativePlanId,
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
}
