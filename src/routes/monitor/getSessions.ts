import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { computeSessionProgress } from "@/agents/shared/sessionProgress";

const router = express.Router();

// 独立监控页面用——返回所有 episode 的进度快照，给页面初次加载时把列表填满，
// 之后的实时增量走 /api/socket/monitor，不用再轮询这个接口
export default router.post("/", async (req, res) => {
  const episodes = await u.db("ab_episode").select("id", "title", "status", "createTime").orderBy("id", "desc");
  const sessions = await Promise.all(
    episodes.map(async (ep: any) => ({
      episodeId: ep.id,
      title: ep.title,
      episodeStatus: ep.status,
      createTime: ep.createTime,
      progress: await computeSessionProgress(ep.id),
    })),
  );
  return res.status(200).send(success(sessions));
});
