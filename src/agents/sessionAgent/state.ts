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
  // uploaded：第一次生成；plan_review：用户对上一批 2 份方案都不满意，点"重新生成方案"再来一批——
  // 一旦有方案被 approve，阶段会推进到 content_review，届时这里就不再放行，不会误伤已经在做内容的方案
  if (episode.workflowStage !== "uploaded" && episode.workflowStage !== "plan_review") {
    throw new Error(`Episode ${episodeId} 当前阶段是 ${episode.workflowStage}，不能重复发起方案生成`);
  }
  // 重新生成时，把上一批还没被选中的方案标记为 rejected，避免"待确认"方案越攒越多
  if (episode.workflowStage === "plan_review") {
    await u.db("ab_creativePlan").where("episodeId", episodeId).where("status", "draft").update({ status: "rejected" });
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

export interface BridgeCutRef {
  id: number;
  index: number;
  type: string;
}

/** M7：桥接流程固定为"过渡视频 → H5 小游戏"两段式，不再由 formatSequence 决定要建几个/什么类型的 cut */
const FIXED_CUT_SEQUENCE = ["video", "playableGame"] as const;

/**
 * 为已确认方案建立固定两段的 ab_bridgeCut 行。只建行，不做任何生成——
 * 生成是调用方（socket 层）在拿到这些行之后派发的（先只生成 video 段，playableGame 段等用户手动确认组装）。
 */
export async function createBridgeCuts(episodeId: number, creativePlanId: number): Promise<BridgeCutRef[]> {
  const episode = await getEpisodeOrThrow(episodeId);
  if (episode.workflowStage !== "content_review") {
    throw new Error(`Episode ${episodeId} 当前阶段是 ${episode.workflowStage}，还没进入内容环节`);
  }
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (!plan || plan.episodeId !== episodeId) throw new Error(`创意方案 ${creativePlanId} 不属于 Episode ${episodeId}`);
  if (plan.status !== "approved") throw new Error(`创意方案 ${creativePlanId} 还没有被确认`);

  const existing = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
  if (existing.length > 0) throw new Error(`创意方案 ${creativePlanId} 已经发起过内容生成，不能重复发起`);

  const rows: BridgeCutRef[] = [];
  for (let index = 0; index < FIXED_CUT_SEQUENCE.length; index++) {
    const type = FIXED_CUT_SEQUENCE[index];
    const [id] = await u.db("ab_bridgeCut").insert({ creativePlanId, index, type, status: "pending", createTime: Date.now() });
    rows.push({ id, index, type });
  }
  return rows;
}

/**
 * M4→M7：纯守卫，不改数据——确认这份方案已经具备落地前终审的条件：
 * 处于 content_review、方案已批准、方案下有固定两段 cut、playableGame 段（唯一真正的最终交付物，
 * video 段只是被嵌进它里面的过渡素材）已完成生成且有已选定的最终产物。满足才返回这个 cut 的引用，不满足直接抛错。
 */
export async function assertContentReady(episodeId: number, creativePlanId: number): Promise<BridgeCutRef> {
  const episode = await getEpisodeOrThrow(episodeId);
  if (episode.workflowStage !== "content_review") {
    throw new Error(`Episode ${episodeId} 当前阶段是 ${episode.workflowStage}，不在内容评审阶段`);
  }
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (!plan || plan.episodeId !== episodeId) throw new Error(`创意方案 ${creativePlanId} 不属于 Episode ${episodeId}`);
  if (plan.status !== "approved") throw new Error(`创意方案 ${creativePlanId} 还没有被确认`);

  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
  if (cuts.length !== 2) throw new Error(`创意方案 ${creativePlanId} 应该有两个内容 cut（视频+小游戏），实际 ${cuts.length} 个，无法落地`);
  const cut = cuts.find((c: any) => c.type === "playableGame");
  if (!cut || cut.id == null || cut.type == null) throw new Error(`创意方案 ${creativePlanId} 缺少 playableGame cut`);
  if (cut.status !== "done") throw new Error(`内容 cut ${cut.id} 当前状态是 ${cut.status}，还没生成完成`);

  const selected = await u.db("ab_generatedSegment").where("bridgeCutId", cut.id).where("stage", "finalRender").where("isSelected", 1).first();
  if (!selected) throw new Error(`内容 cut ${cut.id} 没有已选定的最终产物`);

  return { id: cut.id, index: cut.index ?? 0, type: cut.type };
}

/** M4：纯变更，只在 SupervisorAgent 通过且 Assembler 跑完之后调用 */
export async function enterAssembling(episodeId: number): Promise<void> {
  await u.db("ab_episode").where("id", episodeId).update({ workflowStage: "assembling" });
}
