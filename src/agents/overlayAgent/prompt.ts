import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { OverlayConfig } from "./schema";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): string {
  return [
    `## Episode 结尾基调\n${episodeAnalysis.endingState.summary}（建议基调：${episodeAnalysis.endingState.suggestedTone}）`,
    `## 广告信息\n产品：${ad.product.name}${ad.product.category ? `（${ad.product.category}）` : ""}\n核心卖点：${ad.product.keySellingPoints.join("、")}\n调性：${ad.tone}`,
  ].join("\n\n");
}

export function buildGenerateMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): ModelMessage[] {
  return [{ role: "user", content: `${formatContext(episodeAnalysis, ad)}\n\n请为这条广告构思一张片尾 CTA 卡片的文案和产品图 prompt。` }];
}

export function buildReviseMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, existing: OverlayConfig, feedback: string): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad)}\n\n## 当前卡片\n标题：${existing.headline}\n按钮文案：${existing.ctaCopy}\n跳转链接：${existing.ctaUrl}\n产品图 prompt：${existing.productImagePrompt}\n布局：${existing.layout}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据反馈修改这张卡片。`;
  return [{ role: "user", content: text }];
}

export function buildEvaluationMessages(config: OverlayConfig): ModelMessage[] {
  const text = `## 待评估卡片\n标题：${config.headline}\n按钮文案：${config.ctaCopy}\n跳转链接：${config.ctaUrl}\n产品图 prompt：${config.productImagePrompt}\n布局：${config.layout}\n\n请从位置合理性、遮挡情况、语义相关度三个维度评估这张卡片。`;
  return [{ role: "user", content: text }];
}
