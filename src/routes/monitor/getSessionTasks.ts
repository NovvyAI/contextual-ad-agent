import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { stageLabelForTaskClass } from "@/agents/shared/taskStageLabel";

const router = express.Router();

// 独立监控页面点开某个 session 之后看的详细调用时间线，直接读 o_tasks，按时间正序
export default router.post("/", validateFields({ episodeId: z.number() }), async (req, res) => {
  const { episodeId } = req.body;
  const tasks = await u.db("o_tasks").where("projectId", episodeId).orderBy("startTime", "asc");
  const withStage = tasks.map((t: any) => ({ ...t, stage: stageLabelForTaskClass(t.taskClass) }));
  return res.status(200).send(success(withStage));
});
