import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { computeSessionProgress } from "@/agents/shared/sessionProgress";

const router = express.Router();

// getSessionProgress.ts 的匹配创作会话版本——同样是收到 task:done 后只刷新进度条的轻量接口
export default router.post("/", validateFields({ matchSessionId: z.number() }), async (req, res) => {
  const { matchSessionId } = req.body;
  try {
    const matchSession = await u.db("ab_matchSession").where("id", matchSessionId).first();
    if (!matchSession) return res.status(400).send(error("匹配创作会话不存在"));
    const progress = await computeSessionProgress(matchSession.episodeId!, matchSessionId);
    return res.status(200).send(success(progress));
  } catch (e) {
    return res.status(400).send(error((e as Error).message));
  }
});
