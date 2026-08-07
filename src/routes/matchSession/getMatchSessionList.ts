import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

// 数据量小，直接查两张表在内存里拼，不引入 knex join 语法糖
export default router.post("/", async (req, res) => {
  const rows = await u.db("ab_matchSession").select("id", "episodeId", "adId", "createTime").orderBy("createTime", "desc");
  const episodes = await u.db("ab_episode").select("id", "title");
  const ads = await u.db("ab_ad").select("id", "name");
  const episodeTitle = new Map(episodes.map((e: any) => [e.id, e.title]));
  const adName = new Map(ads.map((a: any) => [a.id, a.name]));

  const list = rows.map((r: any) => ({
    id: r.id,
    episodeId: r.episodeId,
    episodeTitle: episodeTitle.get(r.episodeId) ?? `Episode ${r.episodeId}`,
    adId: r.adId,
    adName: adName.get(r.adId) ?? `营销素材 ${r.adId}`,
    createTime: r.createTime,
  }));
  return res.status(200).send(success(list));
});
