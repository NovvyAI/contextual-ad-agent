import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";

const router = express.Router();

export default router.post("/", async (req, res) => {
  const rows = await u.db("ab_ad").where("status", "analyzed").select("analysisResult");
  const ads = rows.map((r: any) => JSON.parse(r.analysisResult));
  return res.status(200).send(success(ads));
});
