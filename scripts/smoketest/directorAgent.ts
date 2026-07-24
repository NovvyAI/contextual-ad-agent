import u from "@/utils";
import { generatePlans, revisePlan } from "@/agents/directorAgent";

(async () => {
  // 复用 M1 smoketest 已经产出的 analyzed episode/ads，不用重新跑一遍视频分析
  const episode = await u.db("ab_episode").where("id", 1).first();
  if (!episode || episode.status !== "analyzed") throw new Error("episode id=1 不是 analyzed 状态，先跑 storyboardAgent smoketest");

  const adIds = [1, 2, 3];
  console.log("生成创意方案，episodeId=1, adIds=", adIds);
  const plans = await generatePlans(1, adIds);
  console.log("生成的方案:", JSON.stringify(plans, null, 2));

  if (plans.length !== adIds.length) throw new Error(`预期 ${adIds.length} 份方案，实际 ${plans.length}`);
  for (const plan of plans) {
    if (plan.status !== "draft") throw new Error(`方案 ${plan.id} 状态应为 draft，实际 ${plan.status}`);
    if (!Array.isArray(plan.formatSequence) || plan.formatSequence.length === 0) throw new Error(`方案 ${plan.id} formatSequence 为空`);
    if (plan.planEvaluatorScore < 0 || plan.planEvaluatorScore > 100) throw new Error(`方案 ${plan.id} 评分超出范围: ${plan.planEvaluatorScore}`);
    if (!adIds.includes(plan.adId)) throw new Error(`方案 ${plan.id} adId=${plan.adId} 不在候选列表里`);
  }

  const dbRows = await u.db("ab_creativePlan").whereIn(
    "id",
    plans.map((p) => p.id),
  );
  if (dbRows.length !== plans.length) throw new Error("DB 里持久化的行数和返回结果不一致");

  console.log("\n对第一份方案发起 revise...");
  const target = plans[0];
  const feedback = "把这份方案的形式换成纯 CTA 卡片，语气再轻松一点";
  const revised = await revisePlan(target.id, feedback);
  console.log("revise 后的方案:", JSON.stringify(revised, null, 2));

  if (revised.id !== target.id) throw new Error("revise 不应该产生新的行 id");
  if (revised.status !== "draft") throw new Error(`revise 后 status 应重置为 draft，实际 ${revised.status}`);
  if (revised.narrative === target.narrative) throw new Error("revise 后 narrative 应该有变化");

  console.log("\n✅ directorAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ directorAgent smoketest 失败:", err);
  process.exit(1);
});
