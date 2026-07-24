import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { analyzeEpisode } from "@/agents/storyboardAgent";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ episodeId: z.number() }),
  async (req, res) => {
    const { episodeId } = req.body;
    const episode = await u.db("ab_episode").where("id", episodeId).first();
    if (!episode) return res.status(400).send(error("Episode 不存在"));
    if (episode.status === "analyzing") return res.status(400).send(error("已经在分析中，请勿重复触发"));

    // 后台跑，不阻塞响应；失败状态已经在 storyboardAgent 内部落库了
    analyzeEpisode(episodeId).catch(() => {});

    return res.status(200).send(success({ episodeId }));
  },
);
