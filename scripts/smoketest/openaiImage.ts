import fs from "fs";
import u from "@/utils";

(async () => {
  console.log("纯文本生成...");
  const textOnly = await u.Ai.Image("openai:gpt-image-1").run({
    prompt: "A cheerful cartoon mascot holding a smartphone, flat illustration style, vibrant colors.",
    size: "1K",
    aspectRatio: "1:1",
  });
  await textOnly.save("smoketest/openai-image-text.png");
  console.log("已保存: oss/smoketest/openai-image-text.png");

  console.log("\n带参考图生成...");
  const refBase64 = fs.readFileSync("data/test-assets/sample-ad-image.jpg").toString("base64");
  const withRef = await u.Ai.Image("openai:gpt-image-1").run({
    prompt: "Reimagine this product photo with a warm sunset background, keep the product recognizable.",
    referenceList: [{ type: "image", base64: refBase64 }],
    size: "1K",
    aspectRatio: "1:1",
  });
  await withRef.save("smoketest/openai-image-ref.png");
  console.log("已保存: oss/smoketest/openai-image-ref.png");

  console.log("\n✅ openaiImage smoketest 通过");
})().catch((err) => {
  console.error("❌ openaiImage smoketest 失败:", err);
  process.exit(1);
});
