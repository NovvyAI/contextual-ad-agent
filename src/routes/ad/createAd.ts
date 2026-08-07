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
    name: z.string(),
    imageFilePath: z.string().optional(),
    videoFilePath: z.string().optional(),
    textContent: z.string().optional(),
    brandName: z.string().optional(),
  }),
  async (req, res) => {
    const { name, imageFilePath, videoFilePath, textContent, brandName } = req.body;

    // 图片/视频/文案独立可选，但至少要给一种——一条素材现在可以同时带多种形式，不再互斥
    if (!imageFilePath && !videoFilePath && !textContent) return res.status(400).send(error("图片/视频/文案至少要提供一种"));
    if (imageFilePath && !fs.existsSync(imageFilePath)) return res.status(400).send(error(`图片文件不存在: ${imageFilePath}`));
    if (videoFilePath && !fs.existsSync(videoFilePath)) return res.status(400).send(error(`视频文件不存在: ${videoFilePath}`));

    const adType = [imageFilePath && "image", videoFilePath && "video", textContent && "text"].filter(Boolean).join(",");

    const [id] = await u.db("ab_ad").insert({
      name,
      adType,
      imageFilePath: imageFilePath ?? null,
      videoFilePath: videoFilePath ?? null,
      textContent: textContent ?? null,
      brandName: brandName ?? null,
      status: "uploaded",
      createTime: Date.now(),
    });
    return res.status(200).send(success({ id }));
  },
);
