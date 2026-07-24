import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { PlanDraft } from "./schema";

export const GENERATION_SYSTEM_PROMPT =
  "你是短剧广告桥接系统的创意总监（DirectorAgent）。你的任务是为一集短剧的结尾构思如何自然地承接广告内容，" +
  "而不是生硬地打断观看体验。核心原则：\n" +
  "1. 叙事优先——桥接内容要承接 Episode 的结尾状态（情绪、悬念、最后一个画面），不能是生硬的硬切广告。\n" +
  "2. 形式可以自由组合——不必局限于单一形式，可以是「桥接视频 + CTA 卡片」这类组合脚本，只要衔接合理。\n" +
  "3. 每条候选广告构思一份独立方案，方案要体现该广告的核心卖点，同时匹配 Episode 的情绪基调。\n" +
  "4. 你只负责构思，不负责调度或最终决定——用户会看到多份方案并自行选择、修改。";

function formatEpisodeContext(episodeAnalysis: EpisodeAnalysis): string {
  return [
    `## 剧情梗概\n${episodeAnalysis.plot}`,
    `## 结尾状态\n摘要：${episodeAnalysis.endingState.summary}\n是否有悬念：${episodeAnalysis.endingState.cliffhanger ? "是" : "否"}\n最后画面：${episodeAnalysis.endingState.lastVisualDescription}\n建议承接基调：${episodeAnalysis.endingState.suggestedTone}`,
    `## 主要角色\n${episodeAnalysis.characters.map((c) => `- ${c.name}（${c.role}）：${c.description}`).join("\n")}`,
  ].join("\n\n");
}

function formatAdCandidates(ads: AdEntry[]): string {
  return ads
    .map(
      (ad) =>
        `### 广告 id=${ad.id}\n调性：${ad.tone}\n产品：${ad.product.name}${ad.product.category ? `（${ad.product.category}）` : ""}\n核心卖点：${ad.product.keySellingPoints.join("、")}\n摘要：${ad.summary}`,
    )
    .join("\n\n");
}

export function buildPlanGenerationMessages(episodeAnalysis: EpisodeAnalysis, ads: AdEntry[]): ModelMessage[] {
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 候选广告列表\n${formatAdCandidates(ads)}\n\n` +
    `请针对上面每一条候选广告，各构思一份创意方案（formatSequence 里的 adId 必须严格取自上面列出的广告 id）。`;
  return [{ role: "user", content: text }];
}

export function buildPlanEvaluationMessages(episodeAnalysis: EpisodeAnalysis, plans: PlanDraft[]): ModelMessage[] {
  const plansText = plans
    .map(
      (p, i) =>
        `### 方案 ${i}\n对应广告 id：${p.adId}\n形式序列：${p.formatSequence.join(" → ")}\n基调：${p.tone}\n构思：${p.narrative}`,
    )
    .join("\n\n");
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 待评估方案列表\n${plansText}\n\n` +
    `请从叙事衔接可行性、形式选择合理性、与广告诉求匹配度三个维度评估每一份方案，评估结果需要和上面的方案顺序一一对应。`;
  return [{ role: "user", content: text }];
}

export function buildReviseMessages(episodeAnalysis: EpisodeAnalysis, existingPlan: PlanDraft, feedback: string): ModelMessage[] {
  const text =
    `${formatEpisodeContext(episodeAnalysis)}\n\n## 当前方案\n对应广告 id：${existingPlan.adId}\n形式序列：${existingPlan.formatSequence.join(" → ")}\n基调：${existingPlan.tone}\n构思：${existingPlan.narrative}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据用户反馈修改这份方案，adId 保持不变，仅调整 formatSequence / narrative / tone。`;
  return [{ role: "user", content: text }];
}
