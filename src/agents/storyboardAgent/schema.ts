import { z } from "zod";

export const episodeAnalysisSchema = z.object({
  plot: z.string().describe("剧情梗概：整集内容的连贯叙事概述"),
  characters: z
    .array(
      z.object({
        name: z.string().describe("角色名称，若无法确定真实姓名则用描述性代称，如「穿红衣的女子」"),
        description: z.string().describe("角色外貌、性格、在本集中的作用"),
        role: z.enum(["protagonist", "antagonist", "supporting"]).describe("角色定位：主角/反派/配角"),
      }),
    )
    .describe("本集出现的主要角色列表"),
  emotionArc: z
    .array(
      z.object({
        timestampS: z.number().describe("大致时间点（秒）"),
        emotion: z.string().describe("该时间点的情绪基调，如：紧张、温馨、悬疑、高潮"),
        description: z.string().optional().describe("该情绪节点的简要说明"),
      }),
    )
    .describe("情绪基调随时间的变化节点"),
  keyVisuals: z
    .array(
      z.object({
        timestampS: z.number().describe("关键画面出现的大致时间点（秒）"),
        description: z.string().describe("关键画面内容描述"),
        importance: z.enum(["high", "medium", "low"]).optional().describe("重要程度"),
      }),
    )
    .describe("关键画面列表"),
  endingState: z
    .object({
      summary: z.string().describe("结尾状态摘要：本集结束时的悬念/情绪/画面状态"),
      cliffhanger: z.boolean().describe("是否存在悬念钩子"),
      lastVisualDescription: z.string().describe("片尾最后画面的描述，供后续桥接广告衔接参考"),
      suggestedTone: z.string().describe("建议桥接广告承接的情绪基调"),
    })
    .describe("结尾状态，供后续 DirectorAgent 承接桥接广告使用"),
});

export type EpisodeAnalysis = z.infer<typeof episodeAnalysisSchema>;
