import { z } from "zod";

export const planDraftSchema = z.object({
  adId: z.number().describe("本方案采用的广告素材 id，必须是候选广告列表里给出的 id 之一"),
  narrative: z.string().describe("创意构思：这条广告如何承接 Episode 结尾、叙事上如何衔接，避免生硬转场"),
  tone: z.string().describe("本方案的情绪基调，应与 Episode 结尾的 suggestedTone 呼应"),
});

export const planGenerationSchema = z.object({
  plans: z.array(planDraftSchema).describe("针对每条候选广告构思出的创意方案列表，通常一条广告对应一份方案"),
});

export const planEvaluationSchema = z.object({
  narrativeFeasibility: z.number().min(0).max(100).describe("叙事衔接可行性打分：这份方案的构思能否讲得通、衔接是否自然"),
  gameRelevance: z.number().min(0).max(100).describe("游戏关联度打分：这条游戏广告的类型/玩法和 Episode 结尾情绪的承接契合度"),
  adAlignment: z.number().min(0).max(100).describe("与广告诉求匹配度打分：方案是否体现了广告的核心卖点"),
  overallScore: z.number().min(0).max(100).describe("综合参考分，仅供用户参考，不作为自动拦截依据"),
  feedback: z.string().describe("一句话点评，说明打分理由或值得注意的地方"),
});

export const planEvaluationBatchSchema = z.object({
  evaluations: z.array(planEvaluationSchema).describe("与输入方案列表一一对应（按顺序对齐）的评估结果"),
});

export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanEvaluation = z.infer<typeof planEvaluationSchema>;
