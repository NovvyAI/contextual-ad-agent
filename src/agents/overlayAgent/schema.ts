import { z } from "zod";

export const overlayConfigSchema = z.object({
  headline: z.string().describe("卡片主标题，简短有力"),
  ctaCopy: z.string().describe("跳转按钮上的文案，如「立即购买」「了解更多」"),
  ctaUrl: z.string().describe("跳转链接，没有真实链接时用广告方案里的占位链接"),
  productImagePrompt: z.string().describe("用于生成产品图的图片生成 prompt，需体现产品核心卖点和广告调性"),
  layout: z.enum(["center", "bottom"]).describe("卡片布局：产品图居中大图，还是产品图居底、文案居上"),
});

export const overlayEvaluationSchema = z.object({
  positionReasonableness: z.number().min(0).max(100).describe("卡片出现位置/时机是否合理"),
  occlusion: z.number().min(0).max(100).describe("是否遮挡了重要画面内容（片尾静态卡片场景下通常不适用，给高分即可）"),
  semanticRelevance: z.number().min(0).max(100).describe("卡片内容与广告诉求的语义相关度"),
  overallScore: z.number().min(0).max(100).describe("综合参考分，仅供用户参考，不作为自动拦截依据"),
  feedback: z.string().describe("一句话点评"),
});

export type OverlayConfig = z.infer<typeof overlayConfigSchema>;
export type OverlayEvaluation = z.infer<typeof overlayEvaluationSchema>;
