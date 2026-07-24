import u from "@/utils";
import * as state from "@/agents/sessionAgent/state";

(async () => {
  // 克隆一份已分析好的 episode，避免重新跑一遍视频分析，同时保证 workflowStage 从干净的 "uploaded" 开始
  const source = await u.db("ab_episode").where("id", 1).first();
  if (!source || source.status !== "analyzed") throw new Error("episode id=1 不是 analyzed 状态，先跑 storyboardAgent smoketest");

  const [episodeId] = await u.db("ab_episode").insert({
    title: "sessionAgentState-smoketest",
    sourceFilePath: source.sourceFilePath,
    durationMs: source.durationMs,
    status: "analyzed",
    episodeAnalysis: source.episodeAnalysis,
    workflowStage: "uploaded",
    createTime: Date.now(),
  });
  console.log("created episode id:", episodeId);

  console.log("\nstartPlanning...");
  const plans = await state.startPlanning(episodeId, [1, 2]);
  if (plans.length !== 2) throw new Error(`预期 2 份方案，实际 ${plans.length}`);

  let episode = await u.db("ab_episode").where("id", episodeId).first();
  if (episode?.workflowStage !== "plan_review") throw new Error(`预期 plan_review，实际 ${episode?.workflowStage}`);
  console.log("workflowStage:", episode.workflowStage);

  console.log("\napprovePlan...");
  const target = plans[0];
  await state.approvePlan(episodeId, target.id);

  const targetRow = await u.db("ab_creativePlan").where("id", target.id).first();
  if (targetRow?.status !== "approved") throw new Error(`目标方案应为 approved，实际 ${targetRow?.status}`);

  const siblingRow = await u.db("ab_creativePlan").where("id", plans[1].id).first();
  if (siblingRow?.status !== "rejected") throw new Error(`兄弟方案应为 rejected，实际 ${siblingRow?.status}`);

  episode = await u.db("ab_episode").where("id", episodeId).first();
  if (episode?.workflowStage !== "content_review") throw new Error(`预期 content_review，实际 ${episode?.workflowStage}`);
  console.log("workflowStage:", episode.workflowStage);

  console.log("\n再次 approvePlan 应该报错（已经离开 plan_review）...");
  let threw = false;
  try {
    await state.approvePlan(episodeId, plans[1].id);
  } catch (e) {
    threw = true;
    console.log("符合预期，抛出错误:", (e as Error).message);
  }
  if (!threw) throw new Error("重复 approvePlan 应该抛错，但没有");

  console.log("\n✅ sessionAgentState smoketest 通过");
})().catch((err) => {
  console.error("❌ sessionAgentState smoketest 失败:", err);
  process.exit(1);
});
