import u from "@/utils";

/**
 * revise 流程覆盖的目标类型——targetId 的含义随类型变化（plan 是 planId，其余三种是 bridgeCutId），
 * 不建外键约束，因为它指向两张不同的表。
 */
export type ReviseTargetType = "plan" | "bridgeCutDraft" | "bridgeCutMotion" | "playable" | "customGame";

/**
 * 记录一次 revise 的完整前后状态，供以后做训练数据用——revise 前代码里已经拿到了旧对象，
 * 不需要额外查库，这里只是把已经在内存里的 before/after 落成一条历史记录。
 */
export async function recordRevise(targetType: ReviseTargetType, targetId: number, feedback: string, beforeState: unknown, afterState: unknown): Promise<void> {
  await u.db("ab_reviseHistory").insert({
    targetType,
    targetId,
    feedback,
    beforeState: JSON.stringify(beforeState),
    afterState: JSON.stringify(afterState),
    createTime: Date.now(),
  });
}
