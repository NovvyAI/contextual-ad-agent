import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ episodeId: z.number(), adId: z.number() }),
  async (req, res) => {
    const { episodeId, adId } = req.body;

    const episode = await u.db("ab_episode").where("id", episodeId).first();
    if (!episode) return res.status(400).send(error(`Episode ${episodeId} 不存在`));
    if (episode.status !== "analyzed") return res.status(400).send(error(`Episode ${episodeId} 还没有完成剧情分析`));

    const ad = await u.db("ab_ad").where("id", adId).first();
    if (!ad) return res.status(400).send(error(`营销素材 ${adId} 不存在`));
    if (ad.status !== "analyzed") return res.status(400).send(error(`营销素材 ${adId} 还没有完成分析`));

    const [id] = await u.db("ab_matchSession").insert({ episodeId, adId, createTime: Date.now() });
    return res.status(200).send(success({ id }));
  },
);
