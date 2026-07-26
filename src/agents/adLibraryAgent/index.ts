import fs from "fs";
import path from "path";
import type { ModelMessage } from "ai";
import u from "@/utils";
import { sampleFrames, hasAudio, extractAudioToWav } from "@/utils/video";
import { transcribeSegments, type AsrSegment } from "@/utils/asr";
import { adAnalysisSchema, type AdEntry } from "./schema";

const SYSTEM_PROMPT =
  "你是广告素材分析助手。你会收到一条游戏广告素材（游戏演示视频抽帧+台词转写、游戏截图、或游戏介绍文案），" +
  "需要据此产出结构化的广告分析，供后续挑选广告、构思创意桥接方案使用。";

function formatTranscript(segments: AsrSegment[]): string {
  if (segments.length === 0) return "(No speech detected)";
  return segments.map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`).join("\n");
}

function imagePart(filePath: string, mediaType = "image/jpeg") {
  return { type: "image" as const, image: fs.readFileSync(filePath), mediaType };
}

export async function analyzeAd(adId: number): Promise<void> {
  const ad = await u.db("ab_ad").where("id", adId).first();
  if (!ad) throw new Error(`Ad ${adId} 不存在`);

  await u.db("ab_ad").where("id", adId).update({ status: "analyzing", errorReason: null });

  try {
    const sourceType: AdEntry["sourceType"] = ad.adType === "video" ? "video" : ad.adType === "image" ? "image" : "text";
    let hasVisualAsset = false;
    const content: any[] = [{ type: "text", text: "## 广告素材" }];

    if (sourceType === "video") {
      if (!ad.sourceFilePath) throw new Error(`Ad ${adId} 缺少 sourceFilePath`);
      hasVisualAsset = true;
      const workDir = u.getPath(["ad", String(adId)]);

      const frames = await sampleFrames(ad.sourceFilePath, path.join(workDir, "frames"), {
        mode: "scene",
        sceneThreshold: 0.4,
        includeLast: false,
      });
      for (const frame of frames.slice(0, 20)) {
        const ts = frame.approxTimestampS != null ? ` ~${frame.approxTimestampS}s` : "";
        content.push({ type: "text", text: `Frame ${frame.index}${ts}:` }, imagePart(frame.path));
      }

      let segments: AsrSegment[] = [];
      if (await hasAudio(ad.sourceFilePath)) {
        const wavPath = path.join(workDir, "audio.wav");
        await extractAudioToWav(ad.sourceFilePath, wavPath);
        segments = await transcribeSegments(wavPath);
      }
      content.push({ type: "text", text: `## 台词转写\n${formatTranscript(segments)}` });
    } else if (sourceType === "image") {
      if (!ad.sourceFilePath) throw new Error(`Ad ${adId} 缺少 sourceFilePath`);
      hasVisualAsset = true;
      content.push({ type: "text", text: "Asset image:" }, imagePart(ad.sourceFilePath));
    } else {
      if (!ad.textContent) throw new Error(`Ad ${adId} 缺少 textContent`);
      // 和 Python 参考实现一致，在拼 prompt 这一步才截断，而不是采集时截断
      content.push({ type: "text", text: `## 广告文案\n${ad.textContent.slice(0, 2000)}` });
    }

    content.push({ type: "text", text: "请分析这条广告素材的调性、游戏信息、品牌安全性和内容摘要。" });

    const messages: ModelMessage[] = [{ role: "user", content }];

    const { object } = await u.Ai.Text("anthropic:claude-opus-4-8").invokeObject({
      schema: adAnalysisSchema,
      system: SYSTEM_PROMPT,
      messages,
    });

    const entry: AdEntry = { ...object, id: String(adId), sourceType, hasVisualAsset };
    await u.db("ab_ad").where("id", adId).update({ analysisResult: JSON.stringify(entry), status: "analyzed" });
  } catch (e) {
    await u.db("ab_ad").where("id", adId).update({ status: "failed", errorReason: u.error(e).message });
    throw e;
  }
}
