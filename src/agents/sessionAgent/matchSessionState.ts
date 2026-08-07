import u from "@/utils";
import { generatePlans, type CreativePlanWithEvaluation } from "@/agents/directorAgent";
import type { BridgeCutRef } from "@/agents/sessionAgent/state";

/**
 * state.ts 的平行版本——同样是确定性状态机（uploaded → plan_review → content_review → assembling），
 * 但工作流状态挂在 ab_matchSession 而不是 ab_episode，所有权校验也是 plan.matchSessionId 而不是
 * plan.episodeId。这样同一个 Episode 可以有多个匹配会话（配不同广告）各自独立并行推进，互不阻塞——
 * 这正是"匹配会话"这个概念存在的意义。ab_episode.workflowStage 和 legacy 的 /episodes/:id 流程完全不碰。
 *
 * 广告已经在创建匹配会话时锁定（ab_matchSession.adId），所以这里的方案生成不再需要 adIds 数组参数。
 */

async function getMatchSessionOrThrow(matchSessionId: number) {
  const matchSession = await u.db("ab_matchSession").where("id", matchSessionId).first();
  if (!matchSession) throw new Error(`匹配创作会话 ${matchSessionId} 不存在`);
  return matchSession;
}

export async function startPlanning(matchSessionId: number): Promise<CreativePlanWithEvaluation[]> {
  const matchSession = await getMatchSessionOrThrow(matchSessionId);
  if (matchSession.workflowStage !== "uploaded" && matchSession.workflowStage !== "plan_review") {
    throw new Error(`匹配创作会话 ${matchSessionId} 当前阶段是 ${matchSession.workflowStage}，不能重复发起方案生成`);
  }
  if (matchSession.workflowStage === "plan_review") {
    await u.db("ab_creativePlan").where("matchSessionId", matchSessionId).where("status", "draft").update({ status: "rejected" });
  }
  // ab_matchSession.episodeId/adId 建表时没标 notNullable，生成的类型里带 null——
  // 业务上创建匹配会话时这两列必然一起写入，这里非空断言即可
  const plans = await generatePlans(matchSession.episodeId!, [matchSession.adId!]);
  await u.db("ab_creativePlan")
    .whereIn(
      "id",
      plans.map((p) => p.id),
    )
    .update({ matchSessionId });
  await u.db("ab_matchSession").where("id", matchSessionId).update({ workflowStage: "plan_review" });
  return plans;
}

export async function approvePlan(matchSessionId: number, planId: number): Promise<void> {
  const matchSession = await getMatchSessionOrThrow(matchSessionId);
  if (matchSession.workflowStage !== "plan_review") {
    throw new Error(`匹配创作会话 ${matchSessionId} 当前阶段是 ${matchSession.workflowStage}，不在方案评审阶段`);
  }
  const plan = await u.db("ab_creativePlan").where("id", planId).first();
  if (!plan || plan.matchSessionId !== matchSessionId) throw new Error(`创意方案 ${planId} 不属于匹配创作会话 ${matchSessionId}`);
  if (plan.status !== "draft") throw new Error(`创意方案 ${planId} 当前状态是 ${plan.status}，不能确认`);

  await u.db("ab_creativePlan").where("id", planId).update({ status: "approved" });
  await u.db("ab_creativePlan").where("matchSessionId", matchSessionId).whereNot("id", planId).where("status", "draft").update({ status: "rejected" });
  await u.db("ab_matchSession").where("id", matchSessionId).update({ workflowStage: "content_review" });
}

/** M7：桥接流程固定为"过渡视频 → H5 小游戏"两段式，和 state.ts 保持一致 */
const FIXED_CUT_SEQUENCE = ["video", "playableGame"] as const;

export async function createBridgeCuts(matchSessionId: number, creativePlanId: number): Promise<BridgeCutRef[]> {
  const matchSession = await getMatchSessionOrThrow(matchSessionId);
  if (matchSession.workflowStage !== "content_review") {
    throw new Error(`匹配创作会话 ${matchSessionId} 当前阶段是 ${matchSession.workflowStage}，还没进入内容环节`);
  }
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (!plan || plan.matchSessionId !== matchSessionId) throw new Error(`创意方案 ${creativePlanId} 不属于匹配创作会话 ${matchSessionId}`);
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

export async function assertContentReady(matchSessionId: number, creativePlanId: number): Promise<BridgeCutRef> {
  const matchSession = await getMatchSessionOrThrow(matchSessionId);
  if (matchSession.workflowStage !== "content_review") {
    throw new Error(`匹配创作会话 ${matchSessionId} 当前阶段是 ${matchSession.workflowStage}，不在内容评审阶段`);
  }
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (!plan || plan.matchSessionId !== matchSessionId) throw new Error(`创意方案 ${creativePlanId} 不属于匹配创作会话 ${matchSessionId}`);
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

export async function enterAssembling(matchSessionId: number): Promise<void> {
  await u.db("ab_matchSession").where("id", matchSessionId).update({ workflowStage: "assembling" });
}
