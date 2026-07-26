import fs from "fs";
import path from "path";
import u from "@/utils";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import { planGenerationSchema, planEvaluationBatchSchema, type PlanDraft, type PlanEvaluation } from "./schema";
import { buildPlanGenerationMessages, buildPlanEvaluationMessages, buildReviseMessages } from "./prompt";

const MODEL_KEY = "anthropic:claude-opus-4-8";

export interface CreativePlanRow {
  id: number;
  episodeId: number;
  adId: number;
  formatSequence: string[];
  narrative: string;
  tone: string;
  planEvaluatorScore: number;
  status: "draft" | "approved" | "rejected";
  createTime: number;
}

export interface CreativePlanWithEvaluation extends CreativePlanRow {
  evaluatorFeedback: Omit<PlanEvaluation, "overallScore">;
}

async function loadEpisodeAnalysis(episodeId: number): Promise<EpisodeAnalysis> {
  const episode = await u.db("ab_episode").where("id", episodeId).first();
  if (!episode) throw new Error(`Episode ${episodeId} 不存在`);
  if (!episode.episodeAnalysis) throw new Error(`Episode ${episodeId} 还没有完成分析（episodeAnalysis 为空）`);
  return JSON.parse(episode.episodeAnalysis);
}

async function loadAnalyzedAds(adIds: number[]): Promise<AdEntry[]> {
  const rows = await u.db("ab_ad").whereIn("id", adIds);
  const foundIds = new Set(rows.map((r: any) => r.id));
  const missing = adIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) throw new Error(`广告不存在: ${missing.join(", ")}`);
  const notAnalyzed = rows.filter((r: any) => r.status !== "analyzed");
  if (notAnalyzed.length > 0) throw new Error(`以下广告还没有完成分析: ${notAnalyzed.map((r: any) => r.id).join(", ")}`);
  return rows.map((r: any) => JSON.parse(r.analysisResult));
}

function rowFromPlanAndEvaluation(episodeId: number, plan: PlanDraft, evaluation: PlanEvaluation) {
  const { overallScore, ...evaluatorFeedback } = evaluation;
  return {
    episodeId,
    adId: plan.adId,
    // DB 列/下游（SessionAgent、socket 协议）仍然按 formatSequence 数组消费，这里只是把单一 format
    // 包成长度为 1 的数组存进去——既满足"结构上排除组合"（LLM 侧 schema 只产出单值），又不用动 M3 已经上线的代码。
    formatSequence: JSON.stringify([plan.format]),
    narrative: plan.narrative,
    tone: plan.tone,
    planEvaluatorScore: overallScore,
    status: "draft" as const,
    createTime: Date.now(),
    evaluatorFeedback,
  };
}

function toCreativePlanRow(row: any): CreativePlanRow {
  return { ...row, formatSequence: JSON.parse(row.formatSequence) };
}

export async function generatePlans(episodeId: number, adIds: number[]): Promise<CreativePlanWithEvaluation[]> {
  if (adIds.length === 0) throw new Error("adIds 不能为空");
  const episodeAnalysis = await loadEpisodeAnalysis(episodeId);
  const ads = await loadAnalyzedAds(adIds);

  const creativePrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "director_creative.md"), "utf-8");
  const evaluatorPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "director_evaluator.md"), "utf-8");

  const { object: generation } = await u.Ai.Text(MODEL_KEY).invokeObject({
    schema: planGenerationSchema,
    system: creativePrompt,
    messages: buildPlanGenerationMessages(episodeAnalysis, ads),
  });

  const { object: evaluation } = await u.Ai.Text(MODEL_KEY).invokeObject({
    schema: planEvaluationBatchSchema,
    system: evaluatorPrompt,
    messages: buildPlanEvaluationMessages(episodeAnalysis, generation.plans),
  });

  if (evaluation.evaluations.length !== generation.plans.length) {
    throw new Error("PlanEvaluator 返回的评估数量和方案数量不一致");
  }

  const results: CreativePlanWithEvaluation[] = [];
  for (let i = 0; i < generation.plans.length; i++) {
    const toInsert = rowFromPlanAndEvaluation(episodeId, generation.plans[i], evaluation.evaluations[i]);
    const { evaluatorFeedback, ...dbRow } = toInsert;
    const [id] = await u.db("ab_creativePlan").insert(dbRow);
    results.push({ ...toCreativePlanRow({ ...dbRow, id }), evaluatorFeedback });
  }
  return results;
}

export async function revisePlan(planId: number, feedback: string): Promise<CreativePlanWithEvaluation> {
  const row = await u.db("ab_creativePlan").where("id", planId).first();
  if (!row) throw new Error(`创意方案 ${planId} 不存在`);
  if (row.episodeId == null || row.adId == null || row.formatSequence == null || row.narrative == null || row.tone == null) {
    throw new Error(`创意方案 ${planId} 数据不完整`);
  }
  const episodeAnalysis = await loadEpisodeAnalysis(row.episodeId);
  const storedFormats: string[] = JSON.parse(row.formatSequence);
  const existingPlan: PlanDraft = { adId: row.adId, format: storedFormats[0] as PlanDraft["format"], narrative: row.narrative, tone: row.tone };

  const creativePrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "director_creative.md"), "utf-8");
  const evaluatorPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "director_evaluator.md"), "utf-8");

  const { object: revised } = await u.Ai.Text(MODEL_KEY).invokeObject({
    schema: planGenerationSchema.shape.plans.element,
    system: creativePrompt,
    messages: buildReviseMessages(episodeAnalysis, existingPlan, feedback),
  });

  const { object: evaluation } = await u.Ai.Text(MODEL_KEY).invokeObject({
    schema: planEvaluationBatchSchema,
    system: evaluatorPrompt,
    messages: buildPlanEvaluationMessages(episodeAnalysis, [revised]),
  });

  const { evaluatorFeedback, ...dbRow } = rowFromPlanAndEvaluation(row.episodeId, revised, evaluation.evaluations[0]);
  await u.db("ab_creativePlan").where("id", planId).update(dbRow);
  return { ...toCreativePlanRow({ ...dbRow, id: planId }), evaluatorFeedback };
}
