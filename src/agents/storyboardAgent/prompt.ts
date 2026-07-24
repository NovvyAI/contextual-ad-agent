import fs from "fs";
import type { ModelMessage } from "ai";
import type { FrameRecord } from "@/utils/video";
import type { AsrSegment } from "@/utils/asr";

export const EPISODE_ANALYSIS_SYSTEM_PROMPT =
  "你是短剧内容分析助手。你会收到一集短剧的抽帧画面（覆盖全片的稀疏采样 + 结尾部分的密集采样）和台词转写文本，" +
  "需要据此产出结构化的剧集分析，供后续制作广告桥接内容使用。请重点关注结尾部分的画面和情绪状态，" +
  "因为广告将紧接着结尾播放，需要自然衔接。";

function frameToContentParts(frame: FrameRecord, label: string) {
  const ts = frame.approxTimestampS != null ? ` ~${frame.approxTimestampS}s` : "";
  return [
    { type: "text" as const, text: `${label}${ts}:` },
    { type: "image" as const, image: fs.readFileSync(frame.path), mediaType: "image/jpeg" },
  ];
}

function formatTranscript(segments: AsrSegment[]): string {
  if (segments.length === 0) return "(No speech detected)";
  return segments.map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`).join("\n");
}

export function buildEpisodeAnalysisMessages(fullFrames: FrameRecord[], tailFrames: FrameRecord[], segments: AsrSegment[]): ModelMessage[] {
  // 全片帧最多取前 30 张，避免上下文过长；结尾帧不设上限（本来就密集采样，数量有限）
  const cappedFullFrames = fullFrames.slice(0, 30);

  const content: any[] = [{ type: "text", text: "## 全片抽帧（稀疏采样，覆盖整集）" }];
  for (const frame of cappedFullFrames) {
    content.push(...frameToContentParts(frame, `Frame ${frame.index}`));
  }

  content.push({ type: "text", text: "## 结尾部分抽帧（密集采样，用于分析结尾状态）" });
  for (const frame of tailFrames) {
    content.push(...frameToContentParts(frame, `Tail frame ${frame.index}`));
  }

  content.push({ type: "text", text: `## 台词转写\n${formatTranscript(segments)}` });
  content.push({ type: "text", text: "请根据以上画面和台词，分析这一集短剧的剧情、角色、情绪基调、关键画面和结尾状态。" });

  // system 走 generateObject 的 system 参数而不是塞进 messages 里的 system 角色消息，
  // 避免触发 AI SDK 的 "System messages in messages 有 prompt injection 风险" 警告。
  return [{ role: "user", content }];
}
