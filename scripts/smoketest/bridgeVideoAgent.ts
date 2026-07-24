import u from "@/utils";
import { generateDraftCut, reviseDraftCut, confirmAllCuts, renderStageB } from "@/agents/bridgeVideoAgent";

(async () => {
  // 复用 M2 smoketest 留下的已批准方案（id=4, episodeId=3, formatSequence=["video","ctaCard"]）
  const plan = await u.db("ab_creativePlan").where("id", 4).first();
  if (!plan || plan.status !== "approved") throw new Error("plan id=4 不是 approved 状态，先跑 sessionAgentState/sessionAgentSocket smoketest");

  const [cutId] = await u.db("ab_bridgeCut").insert({ creativePlanId: 4, index: 0, type: "video", status: "pending", createTime: Date.now() });
  console.log("created bridgeCut id:", cutId);

  console.log("\nStage A: generateDraftCut...");
  const draft = await generateDraftCut(cutId);
  console.log("草案:", JSON.stringify(draft, null, 2));
  if (!draft.imageUrl) throw new Error("缺少 imageUrl");

  let cutRow = await u.db("ab_bridgeCut").where("id", cutId).first();
  if (cutRow?.status !== "draft") throw new Error(`预期 draft，实际 ${cutRow?.status}`);

  console.log("\n提前 confirmAllCuts（应该报错，因为还没 revise 完/没问题，实际上此时已经是 draft 状态，应该能通过——改成先制造一个未完成场景）...");
  // 注：generateDraftCut 成功后 cut 已经是 draft 状态，此时 confirmAllCuts 理应通过。
  // 这里改为验证"对不存在 video cut 的方案调用会报错"，覆盖 confirmAllCuts 的守卫分支。
  let threwForEmptyPlan = false;
  try {
    await confirmAllCuts(6); // plan id=6 只有 ctaCard，没有 video cut
  } catch (e) {
    threwForEmptyPlan = true;
    console.log("符合预期，抛出错误:", (e as Error).message);
  }
  if (!threwForEmptyPlan) throw new Error("对没有 video cut 的方案调用 confirmAllCuts 应该报错，但没有");

  console.log("\nrevise 这个 cut...");
  const revised = await reviseDraftCut(cutId, "画面再明亮一点，突出产品本身");
  console.log("revise 后:", JSON.stringify(revised, null, 2));
  if (revised.bridgeCutId !== cutId) throw new Error("revise 不应该产生新的 cut");

  console.log("\nconfirmAllCuts（这次应该通过）...");
  await confirmAllCuts(4);
  cutRow = await u.db("ab_bridgeCut").where("id", cutId).first();
  if (cutRow?.status !== "draftConfirmed") throw new Error(`预期 draftConfirmed，实际 ${cutRow?.status}`);

  console.log("\nStage B: renderStageB（真实调用 Seedance，可能需要几分钟）...");
  const rendered = await renderStageB(cutId);
  console.log("成片:", JSON.stringify(rendered, null, 2));
  if (!rendered.videoUrl) throw new Error("缺少 videoUrl");

  cutRow = await u.db("ab_bridgeCut").where("id", cutId).first();
  if (cutRow?.status !== "done") throw new Error(`预期 done，实际 ${cutRow?.status}`);
  const finalSegment = await u.db("ab_generatedSegment").where("bridgeCutId", cutId).where("stage", "finalRender").where("isSelected", 1).first();
  if (!finalSegment) throw new Error("缺少 stage=finalRender isSelected=1 的 segment");

  console.log("\n✅ bridgeVideoAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ bridgeVideoAgent smoketest 失败:", err);
  process.exit(1);
});
