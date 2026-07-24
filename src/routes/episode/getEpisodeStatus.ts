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
    return res.status(200).send(
      success({
        ...episode,
        episodeAnalysis: episode.episodeAnalysis ? JSON.parse(episode.episodeAnalysis) : null,
      }),
    );
  },
);
