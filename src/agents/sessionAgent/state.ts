import u from "@/utils";
import { generatePlans, type CreativePlanWithEvaluation } from "@/agents/directorAgent";

/**
 * 确定性状态机：uploaded → plan_review → content_review → assembling。
 * 这里的每一步都是 if/switch 判断，不经过 LLM——按钮点击类的结构化操作走这里，
 * 只有自由文字反馈才交给 sessionAgent/index.ts 里的 LLM 做意图解析。
 */

async function getEpisodeOrThrow(episodeId: number) {
  const episode = await u.db("ab_episode").where("id", episodeId).first();
  if (!episode) throw new Error(`Episode ${episodeId} 不存在`);
  return episode;
}

export async function startPlanning(episodeId: number, adIds: number[]): Promise<CreativePlanWithEvaluation[]> {
  const episode = await getEpisodeOrThrow(episodeId);
  if (episode.workflowStage !== "uploaded") {
    throw new Error(`Episode ${episodeId} 当前阶段是 ${episode.workflowStage}，不能重复发起方案生成`);
  }
  const plans = await generatePlans(episodeId, adIds);
  await u.db("ab_episode").where("id", episodeId).update({ workflowStage: "plan_review" });
  return plans;
}

export async function approvePlan(episodeId: number, planId: number): Promise<void> {
  const episode = await getEpisodeOrThrow(episodeId);
  if (episode.workflowStage !== "plan_review") {
    throw new Error(`Episode ${episodeId} 当前阶段是 ${episode.workflowStage}，不在方案评审阶段`);
  }
  const plan = await u.db("ab_creativePlan").where("id", planId).first();
  if (!plan || plan.episodeId !== episodeId) throw new Error(`创意方案 ${planId} 不属于 Episode ${episodeId}`);
  if (plan.status !== "draft") throw new Error(`创意方案 ${planId} 当前状态是 ${plan.status}，不能确认`);

  await u.db("ab_creativePlan").where("id", planId).update({ status: "approved" });
  await u.db("ab_creativePlan").where("episodeId", episodeId).whereNot("id", planId).where("status", "draft").update({ status: "rejected" });
  await u.db("ab_episode").where("id", episodeId).update({ workflowStage: "content_review" });
}
