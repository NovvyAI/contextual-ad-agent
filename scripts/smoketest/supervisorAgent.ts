import u from "@/utils";
import { runSupervisionForCut } from "@/agents/supervisorAgent";

async function checkCut(bridgeCutId: number, label: string) {
  console.log(`\n=== ${label}: cut ${bridgeCutId} ===`);
  const result = await runSupervisionForCut(bridgeCutId);
  console.log(JSON.stringify(result, null, 2));
  if (result.bridgeCutId !== bridgeCutId) throw new Error(`预期 bridgeCutId=${bridgeCutId}，实际 ${result.bridgeCutId}`);
  if (typeof result.passed !== "boolean") throw new Error("passed 应该是布尔值");
  return result;
}

(async () => {
  // 复用 M3 smoketest 留下的三条真实产物，不重新生成；用 runSupervisionForCut 而不是 runSupervision
  // 是因为 plan 6/8 都是范围收窄前留下的多 cut 测试数据，plan-级别的 runSupervision 会拒绝这种输入
  const videoCut = await u.db("ab_bridgeCut").where("id", 4).first();
  const ctaCut = await u.db("ab_bridgeCut").where("id", 1).first();
  const playableCut = await u.db("ab_bridgeCut").where("id", 2).first();
  if (!videoCut || !ctaCut || !playableCut) throw new Error("缺少 M3 smoketest 留下的测试数据（cut 1/2/4），先跑一遍 M3 的 smoketest");

  await checkCut(4, "video 类型");
  await checkCut(1, "ctaCard 类型");
  await checkCut(2, "playableGame 类型");

  console.log("\n✅ supervisorAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ supervisorAgent smoketest 失败:", err);
  process.exit(1);
});
