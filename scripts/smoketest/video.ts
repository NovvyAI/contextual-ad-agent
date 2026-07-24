import { probeDuration, hasAudio, sampleFrames, extractTail, extractAudioToWav } from "@/utils/video";

const TEST_VIDEO = "data/test-assets/sample-episode.mp4";

(async () => {
  console.log("=== probeDuration ===");
  const duration = await probeDuration(TEST_VIDEO);
  console.log("duration:", duration);
  if (duration < 11 || duration > 13) throw new Error(`意外的时长: ${duration}`);

  console.log("=== hasAudio ===");
  const audio = await hasAudio(TEST_VIDEO);
  console.log("hasAudio:", audio);
  if (!audio) throw new Error("期望有音轨");

  console.log("=== sampleFrames (interval=2.0) ===");
  const fullFrames = await sampleFrames(TEST_VIDEO, "data/test-assets/tmp/frames", { mode: "interval", interval: 2.0 });
  console.log(
    "frames:",
    fullFrames.map((f) => ({ i: f.index, ts: f.approxTimestampS, isLast: f.isLast })),
  );
  if (fullFrames.length < 5) throw new Error(`帧数太少: ${fullFrames.length}`);

  console.log("=== extractTail (3s) ===");
  await extractTail(TEST_VIDEO, "data/test-assets/tmp/tail.mp4", 3.0);
  const tailDuration = await probeDuration("data/test-assets/tmp/tail.mp4");
  console.log("tail duration:", tailDuration);
  if (tailDuration < 2.5 || tailDuration > 3.5) throw new Error(`tail 时长不对: ${tailDuration}`);

  console.log("=== sampleFrames on tail (interval=1.0) ===");
  const tailFrames = await sampleFrames("data/test-assets/tmp/tail.mp4", "data/test-assets/tmp/tailFrames", {
    mode: "interval",
    interval: 1.0,
    includeLast: false,
  });
  console.log(
    "tail frames:",
    tailFrames.map((f) => ({ i: f.index, ts: f.approxTimestampS })),
  );
  if (tailFrames.length < 2) throw new Error(`tail 帧数太少: ${tailFrames.length}`);

  console.log("=== extractAudioToWav ===");
  await extractAudioToWav(TEST_VIDEO, "data/test-assets/tmp/audio.wav");
  const fs = await import("fs");
  if (!fs.existsSync("data/test-assets/tmp/audio.wav")) throw new Error("audio.wav 没生成");
  console.log("audio.wav size:", fs.statSync("data/test-assets/tmp/audio.wav").size);

  console.log("\n✅ video.ts smoketest 全部通过");
})().catch((err) => {
  console.error("❌ video.ts smoketest 失败:", err);
  process.exit(1);
});
