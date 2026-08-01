import express from "express";
import fs from "fs";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    adId: z.number(),
    name: z.string(),
    brandName: z.string().optional(),
    sourceFilePath: z.string().optional(),
    textContent: z.string().optional(),
  }),
  async (req, res) => {
    const { adId, name, brandName, sourceFilePath, textContent } = req.body;
    const ad = await u.db("ab_ad").where("id", adId).first();
    if (!ad) return res.status(400).send(error("创意素材不存在"));

    const update: Record<string, any> = { name, brandName: brandName ?? null };

    // 只允许改名称/品牌名/内容本身，不允许改 adType——video/image/text 三种类型的字段/校验/后续分析逻辑
    // 完全不同，改类型等同于换一条新素材，让用户删了重建更干净，不做这个转换。
    // 内容（sourceFilePath/textContent）变了就重置成 uploaded 并清空分析结果——analysisResult 是基于
    // 旧内容算出来的，内容换了还留着旧分析结果、旧状态，界面会显示"analyzed"但实际内容对不上。
    let contentChanged = false;
    if (ad.adType === "text") {
      if (!textContent) return res.status(400).send(error("adType=text 需要提供 textContent"));
      if (textContent !== ad.textContent) contentChanged = true;
      update.textContent = textContent;
    } else {
      if (!sourceFilePath) return res.status(400).send(error(`adType=${ad.adType} 需要提供 sourceFilePath`));
      if (!fs.existsSync(sourceFilePath)) return res.status(400).send(error(`文件不存在: ${sourceFilePath}`));
      if (sourceFilePath !== ad.sourceFilePath) contentChanged = true;
      update.sourceFilePath = sourceFilePath;
    }

    if (contentChanged) {
      update.status = "uploaded";
      update.analysisResult = null;
      update.errorReason = null;
    }

    await u.db("ab_ad").where("id", adId).update(update);
    return res.status(200).send(success({ id: adId, contentChanged }));
  },
);
