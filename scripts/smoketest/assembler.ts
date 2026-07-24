import fs from "fs";
import u from "@/utils";
import { assembleCut } from "@/agents/assembler";

async function checkVideo(bridgeCutId: number) {
  console.log(`\n=== video: cut ${bridgeCutId} ===`);
  const result = await assembleCut(bridgeCutId);
  console.log(JSON.stringify(result, null, 2));
  if (result.kind !== "video") throw new Error(`预期 kind=video，实际 ${result.kind}`);
  const absPath = u.getPath(["oss", result.finalFilePath]);
  if (!fs.existsSync(absPath)) throw new Error(`拼接产物不存在: ${absPath}`);
  if (fs.statSync(absPath).size === 0) throw new Error("拼接产物为空");
  console.log("拼接后文件大小:", fs.statSync(absPath).size, "bytes");
}

async function checkCtaCard(bridgeCutId: number) {
  console.log(`\n=== ctaCard: cut ${bridgeCutId} ===`);
  const result = await assembleCut(bridgeCutId);
  console.log(JSON.stringify(result, null, 2));
  if (result.kind !== "video") throw new Error(`预期 kind=video（原片副本），实际 ${result.kind}`);
  const absPath = u.getPath(["oss", result.finalFilePath]);
  if (!fs.existsSync(absPath)) throw new Error(`复制的原片不存在: ${absPath}`);
  if (!result.assets?.ctaImagePath) throw new Error("缺少 ctaImagePath");
}

async function checkPlayable(bridgeCutId: number) {
  console.log(`\n=== playableGame: cut ${bridgeCutId} ===`);
  const result = await assembleCut(bridgeCutId);
  console.log(JSON.stringify(result, null, 2));
  if (result.kind !== "playableBundle") throw new Error(`预期 kind=playableBundle，实际 ${result.kind}`);
  if (!result.finalFilePath.endsWith("/index.html")) throw new Error("finalFilePath 应该指向 index.html");
  const absPath = u.getPath(["oss", result.finalFilePath]);
  if (!fs.existsSync(absPath)) throw new Error(`游戏包 index.html 不存在: ${absPath}`);
}

(async () => {
  await checkVideo(4);
  await checkCtaCard(1);
  await checkPlayable(2);

  console.log("\n✅ assembler smoketest 通过");
})().catch((err) => {
  console.error("❌ assembler smoketest 失败:", err);
  process.exit(1);
});
