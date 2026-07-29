import u from "@/utils";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";

export interface PlanContext {
  planId: number;
  episodeId: number;
  adId: number;
  episodeAnalysis: EpisodeAnalysis;
  ad: AdEntry;
  narrative: string;
  tone: string;
}

/**
 * PlayableAgent/VideoGenAgent/SupervisorAgent 都要从 bridgeCut 反查到 episode+ad 的分析结果，共用这一份。
 * 也把这份方案自己被批准时的 narrative/tone 带上——这是用户实际确认过的具体创意方向，
 * 不带的话下游三个 agent 只能各自从 episodeAnalysis 里重新猜一个基调，和批准的方案对不上。
 */
export async function loadPlanContext(creativePlanId: number): Promise<PlanContext> {
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (!plan) throw new Error(`创意方案 ${creativePlanId} 不存在`);
  if (plan.episodeId == null || plan.adId == null) throw new Error(`创意方案 ${creativePlanId} 数据不完整`);
  if (plan.narrative == null || plan.tone == null) throw new Error(`创意方案 ${creativePlanId} 缺少 narrative/tone`);

  const episode = await u.db("ab_episode").where("id", plan.episodeId).first();
  const ad = await u.db("ab_ad").where("id", plan.adId).first();
  if (!episode?.episodeAnalysis) throw new Error(`Episode ${plan.episodeId} 缺少 episodeAnalysis`);
  if (!ad?.analysisResult) throw new Error(`Ad ${plan.adId} 缺少 analysisResult`);

  return {
    planId: creativePlanId,
    episodeId: plan.episodeId,
    adId: plan.adId,
    episodeAnalysis: JSON.parse(episode.episodeAnalysis),
    ad: JSON.parse(ad.analysisResult),
    narrative: plan.narrative,
    tone: plan.tone,
  };
}
