import u from "@/utils";

// 前提：o_vendorConfig 里 id="imarouter" 的一行已经配置好真实 apiKey 并 enable=1。
// 这个供应商和 ads-gen-agent-main 的 tools/seedance.py 走的是同一个平台（api.imarouter.com）。
// 运行：npx tsx scripts/smoketest/seedance.ts
(async () => {
  const result = await u.Ai.Video("imarouter:seedance-2.0").run({
    duration: 4,
    resolution: "720p",
    aspectRatio: "9:16",
    prompt: "A calm ocean at sunset, cinematic.",
    mode: ["text"],
  });
  await result.save("smoketest/seedance-output.mp4");
  console.log("Seedance smoke test: saved to oss/smoketest/seedance-output.mp4");
})().catch((err) => {
  console.error("Seedance smoke test failed:", err);
  process.exit(1);
});
