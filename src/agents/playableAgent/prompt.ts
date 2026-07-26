import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { PlayableConfig } from "./schema";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): string {
  return [
    `## Episode 结尾基调\n${episodeAnalysis.endingState.summary}（建议基调：${episodeAnalysis.endingState.suggestedTone}）`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n核心玩法：${ad.game.coreMechanic}\n视觉风格：${ad.game.visualStyle}\n核心卖点：${ad.game.keySellingPoints.join("、")}\n调性：${ad.tone}`,
  ].join("\n\n");
}

export function buildGenerateMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): ModelMessage[] {
  return [{ role: "user", content: `${formatContext(episodeAnalysis, ad)}\n\n请为这条广告构思一个配对小游戏的标题、跳转链接和配对素材 prompt。` }];
}

export function buildReviseMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, existing: PlayableConfig, feedback: string): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad)}\n\n## 当前游戏配置\n标题：${existing.title}\n跳转链接：${existing.ctaUrl}\n配对素材 prompt：${existing.tilePrompts.join(" / ")}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据反馈修改这个配置。`;
  return [{ role: "user", content: text }];
}
