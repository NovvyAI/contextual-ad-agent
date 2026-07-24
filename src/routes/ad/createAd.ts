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
    adType: z.enum(["video", "image", "text"]),
    sourceFilePath: z.string().optional(),
    textContent: z.string().optional(),
    brandName: z.string().optional(),
  }),
  async (req, res) => {
    const { name, adType, sourceFilePath, textContent, brandName } = req.body;

    if (adType === "text") {
      if (!textContent) return res.status(400).send(error("adType=text 需要提供 textContent"));
    } else {
      if (!sourceFilePath) return res.status(400).send(error(`adType=${adType} 需要提供 sourceFilePath`));
      if (!fs.existsSync(sourceFilePath)) return res.status(400).send(error(`文件不存在: ${sourceFilePath}`));
    }

    const [id] = await u.db("ab_ad").insert({
      name,
      adType,
      sourceFilePath: sourceFilePath ?? null,
      textContent: textContent ?? null,
      brandName: brandName ?? null,
      status: "uploaded",
      createTime: Date.now(),
    });
    return res.status(200).send(success({ id }));
  },
);
