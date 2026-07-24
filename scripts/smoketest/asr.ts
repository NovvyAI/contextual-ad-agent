import { transcribe } from "@/utils/asr";

// 首次运行会从 Hugging Face 远程下载 Whisper 模型（allowRemoteModels: true），需要联网。
// 运行：npx tsx scripts/smoketest/asr.ts
// 样例音频内容："Testing the whisper transcription pipeline for the ad bridge agent project."
(async () => {
  const text = await transcribe("data/test-assets/sample.wav");
  console.log("Whisper smoke test transcript:", text);
})().catch((err) => {
  console.error("Whisper smoke test failed:", err);
  process.exit(1);
});
