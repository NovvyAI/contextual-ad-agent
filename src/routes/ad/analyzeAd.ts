import express from "express";
import pLimit from "p-limit";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { analyzeAd } from "@/agents/adLibraryAgent";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    adIds: z.array(z.number()).min(1),
    concurrentCount: z.number().int().min(1).optional(),
  }),
  async (req, res) => {
    const { adIds, concurrentCount } = req.body;

    const ads = await u.db("ab_ad").whereIn("id", adIds);
    const missing = adIds.filter((id: number) => !ads.find((a: any) => a.id === id));
    if (missing.length > 0) return res.status(400).send(error(`Ad 不存在: ${missing.join(",")}`));
    const alreadyAnalyzing = ads.filter((a: any) => a.status === "analyzing");
    if (alreadyAnalyzing.length > 0) {
      return res.status(400).send(error(`已经在分析中，请勿重复触发: ${alreadyAnalyzing.map((a: any) => a.id).join(",")}`));
    }

    const limit = pLimit(concurrentCount ?? 2);
    const tasks = adIds.map((id: number) => limit(() => analyzeAd(id).catch(() => {})));
    // 后台执行，不等待结果；失败状态已经在 adLibraryAgent 内部落库了
    Promise.all(tasks).catch(() => {});

    return res.status(200).send(success({ total: adIds.length }));
  },
);
