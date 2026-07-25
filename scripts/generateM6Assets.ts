// M6 一次性素材生成脚本：用项目里已经接好的同一套 AI 生成管线（AiImage/AiVideo），
// 生成比 M0/M1 的 SMPTE 彩条测试图更接近真实观感的"虚构"短剧片段 + 虚构广告素材。
// 全部是 AI 生成的虚构人物/虚构品牌，不涉及真实品牌或真人。跑一次即可，产物直接提交仓库。
import fs from "fs";
import { execSync } from "child_process";
import u from "@/utils";

const IMAGE_MODEL_KEY = "openai:gpt-image-1";
const VIDEO_MODEL_KEY = "imarouter:seedance-2.0";
const OUT_DIR = "data/test-assets";

async function saveImageTo(relOssPath: string, outPath: string, prompt: string, aspectRatio: `${number}:${number}`) {
  const image = await u.Ai.Image(IMAGE_MODEL_KEY).run({ prompt, size: "1K", aspectRatio });
  await image.save(relOssPath);
  const buf = await u.oss.getFile(relOssPath);
  fs.writeFileSync(outPath, buf);
  console.log(`已生成图片: ${outPath} (${buf.length} bytes)`);
}

async function generateEpisode() {
  console.log("\n== 生成短剧片段 ==");
  const stillRelPath = "m6assets/episode-still.png";
  const stillPrompt =
    "Digital illustration, animated short-drama style (not photorealistic, no real human likeness), vertical composition, " +
    "a stylized young woman character standing by a rain-streaked apartment window at night, worried expression, " +
    "warm interior lighting mixed with cool blue window light, holding a phone that shows an incoming call, " +
    "soft cel-shaded rendering, moody webtoon/anime-adjacent art style";
  await saveImageTo(stillRelPath, `${OUT_DIR}/m6-episode-still.png`, stillPrompt, "9:16");

  console.log("对静帧做 image-to-video 动画...");
  const stillBuf = await u.oss.getFile(stillRelPath);
  const video = await u.Ai.Video(VIDEO_MODEL_KEY).run({
    duration: 6,
    resolution: "720p",
    aspectRatio: "9:16",
    prompt:
      "Slow subtle camera push-in, she glances down at the ringing phone, her worried expression shifts to sudden alarm, " +
      "rain continues streaking down the window glass, ambient night city light flickers softly",
    referenceList: [{ type: "image", base64: stillBuf.toString("base64") }],
    mode: ["singleImage"],
  });
  const videoRelPath = "m6assets/episode-raw.mp4";
  await video.save(videoRelPath);
  const videoBuf = await u.oss.getFile(videoRelPath);
  const rawVideoPath = `${OUT_DIR}/m6-episode-raw.mp4`;
  fs.writeFileSync(rawVideoPath, videoBuf);
  console.log(`已生成视频: ${rawVideoPath} (${videoBuf.length} bytes)`);

  console.log("合成配音旁白...");
  const voicePath = `${OUT_DIR}/m6-episode-voice.aiff`;
  const line = "怎么这个时候打电话来，是不是出什么事了。";
  execSync(`say -v Tingting -o "${voicePath}" "${line}"`);

  console.log("ffmpeg 混流...");
  const finalPath = `${OUT_DIR}/m6-episode.mp4`;
  execSync(
    `ffmpeg -y -i "${rawVideoPath}" -i "${voicePath}" -filter_complex "[1:a]apad[aud]" -map 0:v -map "[aud]" ` +
      `-c:v copy -c:a aac -shortest "${finalPath}"`,
  );
  fs.unlinkSync(rawVideoPath);
  fs.unlinkSync(voicePath);
  console.log(`✅ 最终 Episode 素材: ${finalPath}`);
}

interface FictionalAd {
  slug: string;
  brandName: string;
  prompt: string;
}

const FICTIONAL_ADS: FictionalAd[] = [
  {
    slug: "skincare",
    brandName: "Lumira",
    prompt:
      "Professional product photography, a minimalist glass skincare serum bottle labeled 'LUMIRA', soft pink and white gradient background, " +
      "morning light, dew droplets on the glass, high-end beauty ad style, square composition",
  },
  {
    slug: "coldbrew",
    brandName: "Nova Brew",
    prompt:
      "Professional product photography, a sleek matte-black canned cold brew coffee labeled 'NOVA BREW', condensation droplets, " +
      "dark moody background with a single warm spotlight, premium beverage ad style, square composition",
  },
  {
    slug: "earbuds",
    brandName: "Driftline",
    prompt:
      "Professional product photography, a pair of minimalist white wireless earbuds with their charging case labeled 'DRIFTLINE', " +
      "floating over a soft gradient blue background, clean tech-product ad style, square composition",
  },
];

async function generateAds() {
  console.log("\n== 生成虚构广告素材 ==");
  for (const ad of FICTIONAL_ADS) {
    const relOssPath = `m6assets/ad-${ad.slug}.png`;
    const outPath = `${OUT_DIR}/m6-ad-${ad.slug}.jpg`;
    await saveImageTo(relOssPath, outPath, ad.prompt, "1:1");
    console.log(`  品牌名（创建广告时填入 brandName）: ${ad.brandName}`);
  }
}

(async () => {
  await generateEpisode();
  await generateAds();
  console.log("\n✅ M6 素材全部生成完毕，位于 data/test-assets/m6-*");
  console.log("虚构广告品牌名对照表：", FICTIONAL_ADS.map((a) => `${a.slug} → ${a.brandName}`).join("; "));
})().catch((err) => {
  console.error("❌ M6 素材生成失败:", err);
  process.exit(1);
});
