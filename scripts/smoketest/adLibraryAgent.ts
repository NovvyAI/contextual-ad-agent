import u from "@/utils";
import { analyzeAd } from "@/agents/adLibraryAgent";

async function createAndAnalyze(row: Record<string, any>) {
  const [id] = await u.db("ab_ad").insert({ ...row, status: "uploaded", createTime: Date.now() });
  await analyzeAd(id);
  const result = await u.db("ab_ad").where("id", id).first();
  if (!result) throw new Error("ad 行没找到");
  return result;
}

function parseEntry(row: { analysisResult?: string | null }): any {
  if (!row.analysisResult) throw new Error("analysisResult 为空");
  return JSON.parse(row.analysisResult);
}

(async () => {
  console.log("=== video ad ===");
  const videoAd = await createAndAnalyze({
    name: "smoketest-video-ad",
    adType: "video",
    sourceFilePath: "data/test-assets/sample-episode.mp4",
  });
  console.log("status:", videoAd.status, "errorReason:", videoAd.errorReason);
  if (videoAd.status !== "analyzed") throw new Error(`video ad 预期 analyzed，实际 ${videoAd.status}`);
  const videoEntry = parseEntry(videoAd);
  console.log(JSON.stringify(videoEntry, null, 2));
  if (videoEntry.sourceType !== "video") throw new Error("sourceType 不对");
  if (videoEntry.hasVisualAsset !== true) throw new Error("video ad 的 hasVisualAsset 应为 true");

  console.log("\n=== image ad ===");
  const imageAd = await createAndAnalyze({
    name: "smoketest-image-ad",
    adType: "image",
    sourceFilePath: "data/test-assets/sample-ad-image.jpg",
  });
  console.log("status:", imageAd.status, "errorReason:", imageAd.errorReason);
  if (imageAd.status !== "analyzed") throw new Error(`image ad 预期 analyzed，实际 ${imageAd.status}`);
  const imageEntry = parseEntry(imageAd);
  console.log(JSON.stringify(imageEntry, null, 2));
  if (imageEntry.sourceType !== "image") throw new Error("sourceType 不对");
  if (imageEntry.hasVisualAsset !== true) throw new Error("image ad 的 hasVisualAsset 应为 true");

  console.log("\n=== text ad ===");
  const textAd = await createAndAnalyze({
    name: "smoketest-text-ad",
    adType: "text",
    textContent: "全新推出的「清风」空气净化器：三重HEPA滤网，静音运行，30分钟净化40平米空间。限时优惠，立即购买享8折。",
  });
  console.log("status:", textAd.status, "errorReason:", textAd.errorReason);
  if (textAd.status !== "analyzed") throw new Error(`text ad 预期 analyzed，实际 ${textAd.status}`);
  const textEntry = parseEntry(textAd);
  console.log(JSON.stringify(textEntry, null, 2));
  if (textEntry.sourceType !== "text") throw new Error("sourceType 不对");
  if (textEntry.hasVisualAsset !== false) throw new Error("text ad 的 hasVisualAsset 应为 false");

  console.log("\n✅ adLibraryAgent smoketest 全部通过 (video/image/text 三种 sourceType 都验证了)");
})().catch((err) => {
  console.error("❌ adLibraryAgent smoketest 失败:", err);
  process.exit(1);
});
