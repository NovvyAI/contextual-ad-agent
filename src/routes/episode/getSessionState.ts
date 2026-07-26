import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ episodeId: z.number() }),
  async (req, res) => {
    const { episodeId } = req.body;
    const episode = await u.db("ab_episode").where("id", episodeId).first();
    if (!episode) return res.status(400).send(error("Episode 不存在"));

    const planRows = await u.db("ab_creativePlan").where("episodeId", episodeId).orderBy("id");
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

    const manifestRow = await u.db("ab_manifest").where("episodeId", episodeId).orderBy("createTime", "desc").first();
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
        episode: {
          id: episode.id,
          title: episode.title,
          status: episode.status,
          workflowStage: episode.workflowStage,
          durationMs: episode.durationMs,
          createTime: episode.createTime,
          episodeAnalysis: episode.episodeAnalysis ? JSON.parse(episode.episodeAnalysis) : null,
        },
        creativePlans,
        bridgeCuts,
        manifest,
      }),
    );
  },
);
