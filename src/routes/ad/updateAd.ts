import express from "express";
import fs from "fs";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { resolveAdImagePath, resolveAdVideoPath } from "@/agents/shared/adMedia";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    adId: z.number(),
    name: z.string(),
    brandName: z.string().optional(),
    imageFilePath: z.string().optional(),
    videoFilePath: z.string().optional(),
    textContent: z.string().optional(),
  }),
  async (req, res) => {
    const { adId, name, brandName, imageFilePath, videoFilePath, textContent } = req.body;
    const ad = await u.db("ab_ad").where("id", adId).first();
    if (!ad) return res.status(400).send(error("营销素材不存在"));

    if (!imageFilePath && !videoFilePath && !textContent) return res.status(400).send(error("图片/视频/文案至少要提供一种"));
    if (imageFilePath && !fs.existsSync(imageFilePath)) return res.status(400).send(error(`图片文件不存在: ${imageFilePath}`));
    if (videoFilePath && !fs.existsSync(videoFilePath)) return res.status(400).send(error(`视频文件不存在: ${videoFilePath}`));

    // 三个字段独立比较，任意一个变化都算内容变了——沿用原来的逻辑：内容变了就重置成 uploaded 并清空分析结果，
    // 不然界面会显示"analyzed"但实际内容早就对不上旧的 analysisResult 了
    const existingImage = resolveAdImagePath(ad);
    const existingVideo = resolveAdVideoPath(ad);
    const contentChanged = (imageFilePath ?? null) !== existingImage || (videoFilePath ?? null) !== existingVideo || (textContent ?? null) !== ad.textContent;

    const adType = [imageFilePath && "image", videoFilePath && "video", textContent && "text"].filter(Boolean).join(",");
    const update: Record<string, any> = {
      name,
      brandName: brandName ?? null,
      adType,
      imageFilePath: imageFilePath ?? null,
      videoFilePath: videoFilePath ?? null,
      textContent: textContent ?? null,
    };

    if (contentChanged) {
      update.status = "uploaded";
      update.analysisResult = null;
      update.errorReason = null;
    }

    await u.db("ab_ad").where("id", adId).update(update);
    return res.status(200).send(success({ id: adId, contentChanged }));
  },
);
