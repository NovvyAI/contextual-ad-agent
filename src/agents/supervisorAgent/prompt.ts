import fs from "fs";
import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, narrative: string, tone: string): string {
  return [
    `## 已批准的创意方向\n构思：${narrative}\n基调：${tone}`,
    `## Episode 结尾状态\n${episodeAnalysis.endingState.summary}`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n调性：${ad.tone}\n` +
      `AdLibraryAgent 阶段的品牌安全评估：isSafe=${ad.brandSafety.isSafe}${ad.brandSafety.concerns.length ? `，关注点：${ad.brandSafety.concerns.join("、")}` : ""}`,
  ].join("\n\n");
}

function formatCut(cut: { type: string; scriptText: string | null; prompt: string | null; durationMs: number | null }): string {
  const lines = [`类型：${cut.type}`];
  if (cut.scriptText) lines.push(`内容配置：${cut.scriptText}`);
  if (cut.prompt) lines.push(`生成 prompt：${cut.prompt}`);
  if (cut.durationMs) lines.push(`时长：${(cut.durationMs / 1000).toFixed(1)}秒`);
  return lines.join("\n");
}

export function buildSupervisionMessages(
  episodeAnalysis: EpisodeAnalysis,
  ad: AdEntry,
  narrative: string,
  tone: string,
  cut: { type: string; scriptText: string | null; prompt: string | null; durationMs: number | null },
  imageAbsPath: string | null,
): ModelMessage[] {
  const text = `${formatContext(episodeAnalysis, ad, narrative, tone)}\n\n## 待终审内容\n${formatCut(cut)}\n\n请对这份即将交付的桥接内容做落地终审，检查是否偏离了上面"已批准的创意方向"。`;
  const content: any[] = [{ type: "text", text }];
  if (imageAbsPath && fs.existsSync(imageAbsPath)) {
    content.push({ type: "image", image: fs.readFileSync(imageAbsPath), mediaType: "image/png" });
  }
  return [{ role: "user", content }];
}
