import fs from "fs";
import path from "path";
import type { ModelMessage } from "ai";
import u from "@/utils";
import { sampleFrames, hasAudio, extractAudioToWav, type FrameRecord } from "@/utils/video";
import { transcribeSegments, type AsrSegment } from "@/utils/asr";
import { adAnalysisSchema, type AdEntry } from "./schema";

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
    let videoFrames: FrameRecord[] = [];
    const content: any[] = [{ type: "text", text: "## 广告素材" }];

    if (sourceType === "video") {
      if (!ad.sourceFilePath) throw new Error(`Ad ${adId} 缺少 sourceFilePath`);
      hasVisualAsset = true;
      const workDir = u.getPath(["ad", String(adId)]);

      videoFrames = await sampleFrames(ad.sourceFilePath, path.join(workDir, "frames"), {
        mode: "scene",
        sceneThreshold: 0.4,
        includeLast: false,
      });
      for (const frame of videoFrames.slice(0, 20)) {
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

    const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "ad_library_agent.md"), "utf-8");
    // 广告分析不挂在具体某个 episode 下（一条广告可能被多个 episode/session 复用），
    // projectId 用 0 当"不属于任何会话"的哨兵值——真实 episode id 从 1 自增，不会撞上。
    const { object } = await u.Ai.Text("anthropic:claude-opus-4-8").invokeObject(
      {
        schema: adAnalysisSchema,
        system: systemPrompt,
        messages,
      },
      { taskClass: "ad-analysis", describe: `广告 ${adId} 分析`, relatedObjects: String(adId), projectId: 0 },
    );

    const tileCandidates = (object.tileCandidateFrameIndices ?? [])
      .map((i) => videoFrames.find((f) => f.index === i))
      .filter((f): f is FrameRecord => f != null)
      .map((f) => path.basename(f.path));

    const entry: AdEntry = { ...object, id: String(adId), sourceType, hasVisualAsset, tileCandidates };
    await u.db("ab_ad").where("id", adId).update({ analysisResult: JSON.stringify(entry), status: "analyzed" });
  } catch (e) {
    await u.db("ab_ad").where("id", adId).update({ status: "failed", errorReason: u.error(e).message });
    throw e;
  }
}
