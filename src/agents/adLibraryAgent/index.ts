import fs from "fs";
import path from "path";
import type { ModelMessage } from "ai";
import u from "@/utils";
import { sampleFrames, hasAudio, extractAudioToWav, type FrameRecord } from "@/utils/video";
import { transcribeSegments, type AsrSegment } from "@/utils/asr";
import { adAnalysisSchema, adStrategySchema, type AdEntry } from "./schema";
import { buildStrategyMessages } from "./prompt";
import { resolveAdImagePath, resolveAdVideoPath } from "@/agents/shared/adMedia";

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
    // 一条素材现在可以同时带图片+视频+纯文字，三者独立判断是否存在，不再互斥；
    // resolveAdImagePath/resolveAdVideoPath 顺带兼容老数据（单值 adType+sourceFilePath）
    const imageFilePath = resolveAdImagePath(ad);
    const videoFilePath = resolveAdVideoPath(ad);
    const textContent = ad.textContent as string | null;
    const sourceType: AdEntry["sourceType"] = [
      ...(imageFilePath ? (["image"] as const) : []),
      ...(videoFilePath ? (["video"] as const) : []),
      ...(textContent ? (["text"] as const) : []),
    ];
    if (sourceType.length === 0) throw new Error(`Ad ${adId} 没有任何可分析的内容（图片/视频/文案至少要有一个）`);

    let hasVisualAsset = false;
    let videoFrames: FrameRecord[] = [];
    const content: any[] = [{ type: "text", text: "## 广告素材" }];

    if (imageFilePath) {
      hasVisualAsset = true;
      content.push({ type: "text", text: "Asset image:" }, imagePart(imageFilePath));
    }

    if (videoFilePath) {
      hasVisualAsset = true;
      const workDir = u.getPath(["ad", String(adId)]);

      videoFrames = await sampleFrames(videoFilePath, path.join(workDir, "frames"), {
        mode: "scene",
        sceneThreshold: 0.4,
        includeLast: false,
      });
      for (const frame of videoFrames.slice(0, 20)) {
        const ts = frame.approxTimestampS != null ? ` ~${frame.approxTimestampS}s` : "";
        content.push({ type: "text", text: `Frame ${frame.index}${ts}:` }, imagePart(frame.path));
      }

      let segments: AsrSegment[] = [];
      if (await hasAudio(videoFilePath)) {
        const wavPath = path.join(workDir, "audio.wav");
        await extractAudioToWav(videoFilePath, wavPath);
        segments = await transcribeSegments(wavPath);
      }
      content.push({ type: "text", text: `## 台词转写\n${formatTranscript(segments)}` });
    }

    if (textContent) {
      // 和 Python 参考实现一致，在拼 prompt 这一步才截断，而不是采集时截断
      content.push({ type: "text", text: `## 广告文案\n${textContent.slice(0, 2000)}` });
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

    // 第二轮调用：拿第一轮的结果当上下文，产出营销策略维度（视觉定调/情绪基调/物料规划……），
    // 不再需要看图/看视频，纯文本调用；拆成两次调用是为了不让单次结构化输出的字段/嵌套层级过多拖累质量
    const strategySystemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "ad_library_agent_strategy.md"), "utf-8");
    const { object: strategy } = await u.Ai.Text("anthropic:claude-opus-4-8").invokeObject(
      {
        schema: adStrategySchema,
        system: strategySystemPrompt,
        messages: buildStrategyMessages(object, sourceType),
      },
      { taskClass: "ad-strategy-analysis", describe: `广告 ${adId} 营销策略分析`, relatedObjects: String(adId), projectId: 0 },
    );

    const tileCandidates = (object.tileCandidateFrameIndices ?? [])
      .map((i) => videoFrames.find((f) => f.index === i))
      .filter((f): f is FrameRecord => f != null)
      .map((f) => path.basename(f.path));

    const entry: AdEntry = { ...object, ...strategy, id: String(adId), sourceType, hasVisualAsset, tileCandidates };
    await u.db("ab_ad").where("id", adId).update({ analysisResult: JSON.stringify(entry), status: "analyzed" });
  } catch (e) {
    await u.db("ab_ad").where("id", adId).update({ status: "failed", errorReason: u.error(e).message });
    throw e;
  }
}
