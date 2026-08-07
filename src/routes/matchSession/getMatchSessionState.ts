import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { computeSessionProgress } from "@/agents/shared/sessionProgress";

const router = express.Router();

// getSessionState.ts 的匹配创作会话版本——查询条件从 episodeId 换成 matchSessionId，
// 字段整形逻辑（latestDraft/latestRender 的 url 解析等）照抄。ad 的分析结果不重复拉（已经由现有的
// getMatchSessionDetail 覆盖，前端两个接口并行调用），但 episodeAnalysis.tileCandidateImages 这里还是要，
// 因为前端 store 要把两种模式的 sessionState 归一化成同一个形状，ActionBar 组装小游戏时选候选帧要用这个字段。
export default router.post("/", validateFields({ matchSessionId: z.number() }), async (req, res) => {
  const { matchSessionId } = req.body;
  const matchSession = await u.db("ab_matchSession").where("id", matchSessionId).first();
  if (!matchSession) return res.status(400).send(error("匹配创作会话不存在"));
  const episodeId = matchSession.episodeId!;

  const episode = await u.db("ab_episode").where("id", episodeId).first();
  const episodeAnalysis = episode?.episodeAnalysis ? JSON.parse(episode.episodeAnalysis) : null;
  if (episodeAnalysis?.tileCandidates?.length) {
    episodeAnalysis.tileCandidateImages = await Promise.all(
      episodeAnalysis.tileCandidates.map(async (filename: string) => ({
        filename,
        url: await u.oss.getFileUrl(`${episodeId}/frames/${filename}`, "episode"),
      })),
    );
  }

  const planRows = await u.db("ab_creativePlan").where("matchSessionId", matchSessionId).orderBy("id");
  const creativePlans = planRows.map((p: any) => ({
    id: p.id,
    adId: p.adId,
    narrative: p.narrative,
    tone: p.tone,
    planEvaluatorScore: p.planEvaluatorScore,
    status: p.status,
  }));

  const planIds = planRows.map((p: any) => p.id);
  const cutRows = planIds.length ? await u.db("ab_bridgeCut").whereIn("creativePlanId", planIds).orderBy("id") : [];

  const bridgeCuts = await Promise.all(
    cutRows.map(async (cut: any) => {
      const draftSegment = await u.db("ab_generatedSegment").where("bridgeCutId", cut.id).where("stage", "draftImage").where("isSelected", 1).first();
      const renderSegment = await u.db("ab_generatedSegment").where("bridgeCutId", cut.id).where("stage", "finalRender").where("isSelected", 1).first();

      const latestDraft = draftSegment?.filePath ? { imageUrl: await u.oss.getFileUrl(draftSegment.filePath), prompt: cut.prompt ?? null } : null;

      let latestRender: { url: string; filePath: string } | null = null;
      if (renderSegment?.filePath) {
        const relPath = cut.type === "playableGame" ? `${renderSegment.filePath}/index.html` : renderSegment.filePath;
        latestRender = { url: await u.oss.getFileUrl(relPath), filePath: renderSegment.filePath };
      }

      return {
        id: cut.id,
        creativePlanId: cut.creativePlanId,
        index: cut.index,
        type: cut.type,
        status: cut.status,
        durationMs: cut.durationMs,
        latestDraft,
        latestRender,
      };
    }),
  );

  const chatEventRows = await u.db("ab_chatEvent").where("matchSessionId", matchSessionId).orderBy("id");
  const chatEvents = chatEventRows.map((row: any) => ({ eventType: row.eventType, payload: JSON.parse(row.payload) }));

  const progress = await computeSessionProgress(episodeId, matchSessionId);

  const manifestRow = await u.db("ab_manifest").where("matchSessionId", matchSessionId).orderBy("createTime", "desc").first();
  let manifest: { id: number; type: string; deliverableUrl: string; ctaUrl?: string } | null = null;
  if (manifestRow?.manifestJson && manifestRow.id != null) {
    const parsed = JSON.parse(manifestRow.manifestJson);
    manifest = {
      id: manifestRow.id,
      type: parsed.type,
      deliverableUrl: parsed.deliverable?.url,
      ctaUrl: parsed.assets?.ctaUrl,
    };
  }

  return res.status(200).send(
    success({
      matchSession: {
        id: matchSession.id,
        episodeId,
        adId: matchSession.adId,
        workflowStage: matchSession.workflowStage,
        episodeAnalysis,
      },
      creativePlans,
      bridgeCuts,
      manifest,
      chatEvents,
      progress,
    }),
  );
});
