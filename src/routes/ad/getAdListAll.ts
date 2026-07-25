import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

// getAdList.ts 只返回 status=analyzed 的广告、且是转换过的 AdEntry 形状（给 DirectorAgent 消费用），
// 这里单独开一个管理视角的列表，返回所有状态的广告 + 原始字段，照抄 getEpisodeList.ts 的写法
export default router.post("/", async (req, res) => {
  const list = await u.db("ab_ad").select("id", "name", "adType", "status", "brandName", "createTime").orderBy("createTime", "desc");
  return res.status(200).send(success(list));
});
