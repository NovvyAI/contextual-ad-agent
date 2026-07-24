import u from "@/utils";
import { generateOverlay, reviseOverlay } from "@/agents/overlayAgent";

(async () => {
  // 复用 M2 smoketest 留下的已批准方案（id=6, episodeId=4, formatSequence=["ctaCard"]）
  const plan = await u.db("ab_creativePlan").where("id", 6).first();
  if (!plan || plan.status !== "approved") throw new Error("plan id=6 不是 approved 状态，先跑 sessionAgentState/sessionAgentSocket smoketest");

  const [cutId] = await u.db("ab_bridgeCut").insert({ creativePlanId: 6, index: 0, type: "ctaCard", status: "pending", createTime: Date.now() });
  console.log("created bridgeCut id:", cutId);

  const result = await generateOverlay(cutId);
  console.log("生成结果:", JSON.stringify(result, null, 2));
  if (!result.config.headline) throw new Error("缺少 headline");
  if (!result.imageUrl) throw new Error("缺少 imageUrl");

  const cutRow = await u.db("ab_bridgeCut").where("id", cutId).first();
  if (cutRow?.status !== "done") throw new Error(`预期 done，实际 ${cutRow?.status}`);
  const segment = await u.db("ab_generatedSegment").where("bridgeCutId", cutId).where("isSelected", 1).first();
  if (!segment) throw new Error("缺少 isSelected=1 的 segment");

  console.log("\nrevise...");
  const revised = await reviseOverlay(cutId, "文案换得更活泼一点，标题短一点");
  console.log("revise 后:", JSON.stringify(revised, null, 2));
  if (revised.bridgeCutId !== cutId) throw new Error("revise 不应该产生新的 cut");

  const segmentsAfterRevise = await u.db("ab_generatedSegment").where("bridgeCutId", cutId);
  const selectedCount = segmentsAfterRevise.filter((s: any) => s.isSelected === 1).length;
  if (selectedCount !== 1) throw new Error(`预期只有 1 行 isSelected=1，实际 ${selectedCount}`);

  console.log("\n✅ overlayAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ overlayAgent smoketest 失败:", err);
  process.exit(1);
});
