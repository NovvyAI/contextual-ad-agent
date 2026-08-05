import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { computeSessionProgress } from "@/agents/shared/sessionProgress";

const router = express.Router();

// 单独拆出来的轻量接口——会话页面收到 task:done 事件后只想刷新进度条，不想把 getSessionState
// 那份完整会话状态（聊天记录、方案列表、cut 详情）重新拉一遍，那样太重也容易引起不必要的重渲染
export default router.post("/", validateFields({ episodeId: z.number() }), async (req, res) => {
  const { episodeId } = req.body;
  try {
    const progress = await computeSessionProgress(episodeId);
    return res.status(200).send(success(progress));
  } catch (e) {
    return res.status(400).send(error((e as Error).message));
  }
});
