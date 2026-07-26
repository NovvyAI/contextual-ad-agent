import { z } from "zod";

export const shotSizeEnum = z.enum(["远景", "全景", "中景", "近景", "特写", "大特写"]);
export const cameraMovementEnum = z.enum(["静止", "推进", "拉远", "跟踪", "摇镜", "甩镜", "升降", "环绕"]);

export const stageADraftSchema = z.object({
  shotSize: shotSizeEnum.describe("镜头景别"),
  cameraMovement: cameraMovementEnum.describe("运镜方式"),
  subjectAction: z
    .string()
    .describe("画面主体的动作/状态，以及从 Episode 结尾画面过渡到游戏开场的具体呈现方式，严格基于给定的结尾状态和游戏信息，不编造额外情节"),
  lightingMood: z.string().describe("光影氛围"),
  emotionalTone: z.string().describe("情绪基调，应承接 Episode 结尾观众的情绪状态"),
  framingNotes: z.string().describe("构图/机位的简短补充说明，供 Stage B 渲染成片时保持连贯参考，不直接喂给模型"),
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

export type ShotSize = z.infer<typeof shotSizeEnum>;
export type CameraMovement = z.infer<typeof cameraMovementEnum>;
export type StageADraft = z.infer<typeof stageADraftSchema>;
export type BridgeVideoEvaluation = z.infer<typeof bridgeVideoEvaluationSchema>;
