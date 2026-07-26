import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { StageADraft } from "./schema";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): string {
  return [
    `## Episode 结尾状态\n摘要：${episodeAnalysis.endingState.summary}\n最后画面：${episodeAnalysis.endingState.lastVisualDescription}\n建议承接基调：${episodeAnalysis.endingState.suggestedTone}`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n核心卖点：${ad.game.keySellingPoints.join("、")}\n调性：${ad.tone}`,
  ].join("\n\n");
}

export function buildStageADraftMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): ModelMessage[] {
  const text = `${formatContext(episodeAnalysis, ad)}\n\n参考图分别是 Episode 结尾最后一帧画面、广告素材参考图（如果有）。请构思一张分镜草案图的 prompt，承接结尾画面过渡到广告。`;
  return [{ role: "user", content: text }];
}

export function buildReviseMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, existing: StageADraft, feedback: string): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad)}\n\n## 当前分镜草案\nprompt：${existing.prompt}\n构图说明：${existing.framingNotes}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据反馈修改这张分镜草案的 prompt。`;
  return [{ role: "user", content: text }];
}
