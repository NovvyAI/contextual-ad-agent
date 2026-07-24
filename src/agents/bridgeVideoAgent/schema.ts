import { z } from "zod";

export const stageADraftSchema = z.object({
  prompt: z.string().describe("喂给图片生成模型的分镜草案 prompt，需体现从 Episode 结尾画面到广告开场的过渡构思"),
  framingNotes: z.string().describe("构图/机位/转场设想的简短说明，供 Stage B 渲染成片时保持连贯参考，不直接喂给模型"),
});

export const bridgeVideoEvaluationSchema = z.object({
  narrativeContinuity: z.number().min(0).max(100).describe("叙事连续性：是否承接了 Episode 结尾的情节/悬念"),
  visualConsistency: z.number().min(0).max(100).describe("视觉一致性：人物/场景/画风是否和 Episode 保持一致"),
  transitionSmoothness: z.number().min(0).max(100).describe("转场自然度：是否生硬切入广告"),
  emotionalArc: z.number().min(0).max(100).describe("情绪曲线：情绪基调过渡是否顺畅"),
  adIntegration: z.number().min(0).max(100).describe("广告融合度：是否体现了广告的核心卖点"),
  audioContinuity: z.number().min(0).max(100).describe("音频连续性（Stage A 静态草案阶段无音频，给中性偏高分即可；Stage B 成片阶段才真正评估）"),
  overallScore: z.number().min(0).max(100).describe("综合参考分，仅供用户参考，不作为自动拦截依据"),
  feedback: z.string().describe("一句话点评"),
});

export type StageADraft = z.infer<typeof stageADraftSchema>;
export type BridgeVideoEvaluation = z.infer<typeof bridgeVideoEvaluationSchema>;
