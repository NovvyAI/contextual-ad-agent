import u from "@/utils";
import * as matchSessionState from "@/agents/sessionAgent/matchSessionState";
import * as supervisorAgent from "@/agents/supervisorAgent";
import * as assembler from "@/agents/assembler";
import ResTool from "@/socket/resTool";
import { isValidImageModelKey } from "@/agents/shared/imageModel";
import { isValidVideoModelKey } from "@/agents/shared/videoModel";
import { isValidVideoResolution } from "@/agents/shared/videoResolution";
import { generateCutContent } from "@/agents/sessionAgent/actions";

// actions.ts 里只有这 3 个函数真正耦合 episodeId（转手传给 state.ts 去读写 ab_episode.workflowStage），
// 这里镜像成读写 ab_matchSession.workflowStage 的版本。其余 4 个函数（generateCutContent/
// confirmDraftCutsAction/assemblePlayableAction/generateCustomGameAction）已经纯 creativePlanId/
// bridgeCutId 寻址，两种模式共用，直接从 actions.ts re-export，不重复实现。
export { generateCutContent, confirmDraftCutsAction, assemblePlayableAction, generateCustomGameAction } from "@/agents/sessionAgent/actions";

/** 确认某一份创意方案——按钮点击 plan:approve、聊天说"我选方案1"共用 */
export async function confirmPlanAction(resTool: ResTool, matchSessionId: number, planId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    await matchSessionState.approvePlan(matchSessionId, planId);
    const text = msg.text(`已确认方案 ${planId}，进入内容生成阶段。`);
    text.complete();
    msg.complete();
  } catch (err) {
    msg.error(u.error(err).message);
  }
}

/** 为已确认方案生成内容（固定两段式：只生成 video 段草案，playableGame 段留给 assemblePlayableAction） */
export async function generateContentAction(
  resTool: ResTool,
  matchSessionId: number,
  creativePlanId: number,
  imageModelKey?: string,
  videoModelKey?: string,
  videoResolution?: string,
): Promise<void> {
  const ackMsg = resTool.newMessage("assistant");
  const ackText = ackMsg.text("已确认，正在生成分镜草案，请稍候...");
  ackText.complete();
  ackMsg.complete();

  try {
    if (imageModelKey && isValidImageModelKey(imageModelKey)) {
      await u.db("ab_creativePlan").where("id", creativePlanId).update({ imageModelKey });
    }
    if (videoModelKey && isValidVideoModelKey(videoModelKey)) {
      await u.db("ab_creativePlan").where("id", creativePlanId).update({ videoModelKey });
    }
    if (videoResolution && isValidVideoResolution(videoResolution)) {
      await u.db("ab_creativePlan").where("id", creativePlanId).update({ videoResolution });
    }
    const cuts = await matchSessionState.createBridgeCuts(matchSessionId, creativePlanId);
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

/** 落地前终审 + 落地组装 */
export async function confirmContentAction(resTool: ResTool, matchSessionId: number, creativePlanId: number): Promise<void> {
  const msg = resTool.newMessage("assistant");
  try {
    const matchSession = await u.db("ab_matchSession").where("id", matchSessionId).first();
    if (!matchSession) throw new Error(`匹配创作会话 ${matchSessionId} 不存在`);
    // ab_matchSession.episodeId 建表时没标 notNullable，生成的类型里带 null——业务上创建匹配会话时
    // 这一列必然和 adId 一起写入，这里非空断言即可
    const episodeId: number = matchSession.episodeId!;

    await matchSessionState.assertContentReady(matchSessionId, creativePlanId);

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

    const manifestId = await assembler.assemble(episodeId, creativePlanId, supervision, matchSessionId);
    await matchSessionState.enterAssembling(matchSessionId);

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
