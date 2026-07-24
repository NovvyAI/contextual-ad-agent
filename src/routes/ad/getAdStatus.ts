import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ adId: z.number() }),
  async (req, res) => {
    const { adId } = req.body;
    const ad = await u.db("ab_ad").where("id", adId).first();
    if (!ad) return res.status(400).send(error("Ad 不存在"));
    return res.status(200).send(
      success({
        ...ad,
        analysisResult: ad.analysisResult ? JSON.parse(ad.analysisResult) : null,
      }),
    );
  },
);
