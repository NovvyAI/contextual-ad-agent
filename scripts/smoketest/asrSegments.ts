import { transcribeSegments } from "@/utils/asr";

(async () => {
  const segments = await transcribeSegments("data/test-assets/sample.wav");
  console.log("segments:", JSON.stringify(segments, null, 2));

  if (segments.length === 0) throw new Error("没有识别出任何分段");
  for (const s of segments) {
    if (!(s.start < s.end)) throw new Error(`时间戳不对: start=${s.start} end=${s.end}`);
    if (!s.text) throw new Error("有分段文本为空");
  }

  console.log("\n✅ asrSegments smoketest 通过");
})().catch((err) => {
  console.error("❌ asrSegments smoketest 失败:", err);
  process.exit(1);
});
