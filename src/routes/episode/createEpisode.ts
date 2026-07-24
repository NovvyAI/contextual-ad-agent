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
    title: z.string(),
    sourceFilePath: z.string(),
  }),
  async (req, res) => {
    const { title, sourceFilePath } = req.body;
    if (!fs.existsSync(sourceFilePath)) {
      return res.status(400).send(error(`文件不存在: ${sourceFilePath}`));
    }
    const [id] = await u.db("ab_episode").insert({
      title,
      sourceFilePath,
      status: "uploaded",
      createTime: Date.now(),
    });
    return res.status(200).send(success({ id }));
  },
);
