import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const rows = await u.db("ab_ad").where("status", "analyzed").select("name", "analysisResult");
  // AdEntry 是给 DirectorAgent 消费的既定形状（架构文档定义），name 是额外补的、只给前端展示用，
  // DirectorAgent 走的是 directorAgent/index.ts 直接查 ab_ad，不读这个接口，加这个字段不影响它。
  const ads = rows.map((r: any) => ({ ...JSON.parse(r.analysisResult), name: r.name }));
  return res.status(200).send(success(ads));
});
