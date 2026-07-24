import u from "@/utils";
import { analyzeEpisode } from "@/agents/storyboardAgent";

(async () => {
  const [episodeId] = await u.db("ab_episode").insert({
    title: "smoketest-episode",
    sourceFilePath: "data/test-assets/sample-episode.mp4",
    status: "uploaded",
    createTime: Date.now(),
  });
  console.log("created episode id:", episodeId);

  await analyzeEpisode(episodeId);

  const row = await u.db("ab_episode").where("id", episodeId).first();
  if (!row) throw new Error("episode 行没找到");
  console.log("status:", row.status);
  if (row.status !== "analyzed") throw new Error(`预期 analyzed，实际 ${row.status}，errorReason=${row.errorReason}`);

  if (!row.episodeAnalysis) throw new Error("episodeAnalysis 为空");
  const analysis = JSON.parse(row.episodeAnalysis);
  console.log("episodeAnalysis:", JSON.stringify(analysis, null, 2));

  if (!analysis.plot) throw new Error("缺少 plot");
  if (!Array.isArray(analysis.characters)) throw new Error("characters 不是数组");
  if (!Array.isArray(analysis.emotionArc)) throw new Error("emotionArc 不是数组");
  if (!Array.isArray(analysis.keyVisuals)) throw new Error("keyVisuals 不是数组");
  if (!analysis.endingState?.summary) throw new Error("缺少 endingState.summary");

  console.log("\n✅ storyboardAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ storyboardAgent smoketest 失败:", err);
  process.exit(1);
});
