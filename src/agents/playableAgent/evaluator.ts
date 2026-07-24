import { z } from "zod";
import u from "@/utils";
import type { PlayableConfig } from "./schema";

export const playableEvaluationSchema = z.object({
  interactionExperience: z.number().min(0).max(100).describe("互动体验：游戏是否有趣、上手是否顺畅"),
  functionalCompleteness: z.number().min(0).max(100).describe("功能完整性：素材/跳转链接等是否齐全可用"),
  overallScore: z.number().min(0).max(100).describe("综合参考分，仅供用户参考，不作为自动拦截依据"),
  feedback: z.string().describe("一句话点评"),
});

export type PlayableEvaluation = z.infer<typeof playableEvaluationSchema>;

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";

export async function evaluatePlayable(config: PlayableConfig): Promise<PlayableEvaluation> {
  const text = `## 待评估游戏配置\n标题：${config.title}\n跳转链接：${config.ctaUrl}\n配对素材 prompt：${config.tilePrompts.join(" / ")}\n\n请从互动体验、功能完整性两个维度评估这个配对小游戏配置。`;
  const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject({
    schema: playableEvaluationSchema,
    system: "你评估一个 H5 配对小游戏广告的配置质量，只做预筛参考，不做自动拦截。",
    messages: [{ role: "user", content: text }],
  });
  return object;
}
