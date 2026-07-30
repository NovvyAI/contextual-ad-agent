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
      viewerEmotionalState: z
        .object({
          primaryEmotion: z.string().describe("观众看完本集后的主要情绪，如：紧张/期待/失落"),
          intensity: z.enum(["high", "medium", "low"]).describe("该情绪的强烈程度"),
          residualTension: z.string().describe("尚未被满足/化解的心理诉求"),
          transitionReadiness: z.string().describe("这种状态下观众适合被引导承接什么样的内容"),
        })
        .describe("观众（而非剧中角色/场景）看完结尾后的情绪状态，供桥接内容设计的心理落点参考"),
    })
    .describe("结尾状态，供后续 DirectorAgent 承接桥接广告使用"),
  tileCandidateFrameIndices: z
    .array(z.number().int().min(0))
    .max(8)
    .optional()
    .describe(
      "从上面展示的编号帧（Frame N，覆盖全片的稀疏采样）里挑出清晰展示主要角色或有代表性场景的帧序号，" +
        "供后续生成桥接内容时作为视觉素材候选参考；模糊、转场、无关的空镜头不要选，找不到合适的就返回空数组。" +
        "只从 Frame N 编号的帧里选，不要参考结尾部分的 Tail frame N。",
    ),
});

// 代码从 tileCandidateFrameIndices 映射出的实际帧文件名；老数据没有这个字段，消费方都要按可能是 undefined 处理
export interface EpisodeAnalysis extends z.infer<typeof episodeAnalysisSchema> {
  tileCandidates?: string[];
}
