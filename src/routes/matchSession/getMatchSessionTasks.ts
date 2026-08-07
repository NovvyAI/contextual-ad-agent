import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { stageLabelForTaskClass } from "@/agents/shared/taskStageLabel";

const router = express.Router();

// getSessionTasks.ts 的匹配创作会话版本——o_tasks.projectId 全项目统一用 episodeId（不是 matchSessionId），
// 这里查出真实 episodeId 之后走一样的查询。已知限制：同一个 Episode 如果有多个匹配会话同时在跑生成，
// 这里看到的时间轴不会按匹配会话隔离，会看到彼此的调用记录（见本次改动 CHANGELOG/plan 里的说明）。
export default router.post("/", validateFields({ matchSessionId: z.number() }), async (req, res) => {
  const { matchSessionId } = req.body;
  const matchSession = await u.db("ab_matchSession").where("id", matchSessionId).first();
  if (!matchSession) return res.status(400).send(error("匹配创作会话不存在"));

  const tasks = await u.db("o_tasks").where("projectId", matchSession.episodeId).orderBy("startTime", "asc");
  const withStage = tasks.map((t: any) => ({ ...t, stage: stageLabelForTaskClass(t.taskClass) }));
  return res.status(200).send(success(withStage));
});
