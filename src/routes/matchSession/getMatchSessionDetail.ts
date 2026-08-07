import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ matchSessionId: z.number() }),
  async (req, res) => {
    const { matchSessionId } = req.body;
    const row = await u.db("ab_matchSession").where("id", matchSessionId).first();
    if (!row) return res.status(400).send(error(`匹配创作会话 ${matchSessionId} 不存在`));

    const episode = await u.db("ab_episode").where("id", row.episodeId).first();
    const ad = await u.db("ab_ad").where("id", row.adId).first();

    const episodeAnalysis = episode?.episodeAnalysis ? JSON.parse(episode.episodeAnalysis) : null;
    // tileCandidates 落库的是帧文件名，这里拼成可直接展示的 url——和 getSessionState.ts 里
    // 同一段逻辑一模一样，两处都要给 EpisodeAnalysisPanel.vue 的候选素材图片喂真实 url
    if (episodeAnalysis?.tileCandidates?.length) {
      episodeAnalysis.tileCandidateImages = await Promise.all(
        episodeAnalysis.tileCandidates.map(async (filename: string) => ({
          filename,
          url: await u.oss.getFileUrl(`${row.episodeId}/frames/${filename}`, "episode"),
        })),
      );
    }

    return res.status(200).send(
      success({
        id: row.id,
        episodeId: row.episodeId,
        episodeTitle: episode?.title ?? `Episode ${row.episodeId}`,
        episodeAnalysis,
        adId: row.adId,
        adName: ad?.name ?? `营销素材 ${row.adId}`,
        adAnalysisResult: ad?.analysisResult ?? null,
      }),
    );
  },
);
