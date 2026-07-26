import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { PlanDraft } from "./schema";

function formatEpisodeContext(episodeAnalysis: EpisodeAnalysis): string {
  return [
    `## 剧情梗概\n${episodeAnalysis.plot}`,
    `## 结尾状态\n摘要：${episodeAnalysis.endingState.summary}\n是否有悬念：${episodeAnalysis.endingState.cliffhanger ? "是" : "否"}\n最后画面：${episodeAnalysis.endingState.lastVisualDescription}\n建议承接基调：${episodeAnalysis.endingState.suggestedTone}`,
    `## 观众看完后的情绪状态\n主要情绪：${episodeAnalysis.endingState.viewerEmotionalState.primaryEmotion}（强度：${episodeAnalysis.endingState.viewerEmotionalState.intensity}）\n尚未满足的心理诉求：${episodeAnalysis.endingState.viewerEmotionalState.residualTension}\n适合承接的内容方向：${episodeAnalysis.endingState.viewerEmotionalState.transitionReadiness}`,
    `## 主要角色\n${episodeAnalysis.characters.map((c) => `- ${c.name}（${c.role}）：${c.description}`).join("\n")}`,
  ].join("\n\n");
}

function formatAdCandidates(ads: AdEntry[]): string {
  return ads
    .map(
      (ad) =>
        `### 广告 id=${ad.id}\n调性：${ad.tone}\n游戏：${ad.game.name}（${ad.game.genre}）\n核心玩法：${ad.game.coreMechanic}\n视觉风格：${ad.game.visualStyle}\n核心卖点：${ad.game.keySellingPoints.join("、")}\n摘要：${ad.summary}`,
    )
    .join("\n\n");
}

export function buildPlanGenerationMessages(episodeAnalysis: EpisodeAnalysis, ads: AdEntry[]): ModelMessage[] {
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 候选广告列表\n${formatAdCandidates(ads)}\n\n` +
    `请针对上面每一条候选广告，各构思一份创意方案（adId 必须严格取自上面列出的广告 id）。`;
  return [{ role: "user", content: text }];
}

export function buildPlanEvaluationMessages(episodeAnalysis: EpisodeAnalysis, plans: PlanDraft[]): ModelMessage[] {
  const plansText = plans.map((p, i) => `### 方案 ${i}\n对应广告 id：${p.adId}\n基调：${p.tone}\n构思：${p.narrative}`).join("\n\n");
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 待评估方案列表\n${plansText}\n\n` +
    `请从叙事衔接可行性、游戏关联度、与广告诉求匹配度三个维度评估每一份方案，评估结果需要和上面的方案顺序一一对应。`;
  return [{ role: "user", content: text }];
}

export function buildReviseMessages(episodeAnalysis: EpisodeAnalysis, existingPlan: PlanDraft, feedback: string): ModelMessage[] {
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 当前方案\n对应广告 id：${existingPlan.adId}\n基调：${existingPlan.tone}\n构思：${existingPlan.narrative}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据用户反馈修改这份方案，adId 保持不变，仅调整 narrative / tone。`;
  return [{ role: "user", content: text }];
}
