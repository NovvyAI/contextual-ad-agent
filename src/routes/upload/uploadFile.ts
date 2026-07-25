import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

// 前端"选择本地文件"弹窗上传到这里，落到 data/uploads/ 下，返回一个可以直接填进
// createEpisode/createAd 的 sourceFilePath 文本框的相对路径——和现有"服务器本地文件路径"
// 的约定保持一致，不引入新的路径形态。
const uploadDir = u.getPath(["uploads"]);
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-一-龥]/g, "_")
      .slice(0, 80);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

export default router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).send(error("未收到文件"));
  const relPath = path.relative(process.cwd(), req.file.path);
  return res.status(200).send(success({ path: relPath, originalName: req.file.originalname }));
});
