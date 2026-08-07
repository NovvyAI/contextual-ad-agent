import { z } from "zod";

// 这是 LLM 要返回的部分——id/sourceType/hasVisualAsset 由代码这边算，不问模型要
export const adAnalysisSchema = z.object({
  tone: z.string().describe("广告调性/风格，如：幽默、温情、专业、刺激"),
  game: z.object({
    name: z.string().describe("游戏名称"),
    genre: z.string().describe("游戏类型/品类，如：休闲益智、放置、卡牌、跑酷"),
    coreMechanic: z.string().describe("核心玩法机制简述"),
    visualStyle: z.string().describe("视觉风格描述，如：像素风、Q版3D、写实、二次元"),
    keySellingPoints: z.array(z.string()).describe("核心卖点列表"),
  }),
  brandSafety: z.object({
    isSafe: z.boolean().describe("是否通过品牌安全检查（无暴力、无争议内容等）"),
    concerns: z.array(z.string()).describe("潜在风险点列表，若无风险则为空数组"),
  }),
  summary: z.string().describe("素材内容摘要"),
  tileCandidateFrameIndices: z
    .array(z.number().int().min(0))
    .max(8)
    .optional()
    .describe(
      "仅当输入包含多帧编号截图（Frame N）时填写：从中挑出最适合直接用作配对小游戏素材的帧序号，" +
        "要求画面清晰、能代表游戏真实界面/玩法/角色，不要选模糊、纯黑屏、转场过渡或空镜头的帧，找不到合适的就返回空数组；" +
        "单张图片或纯文案素材不用填写这个字段。",
    ),
});

export type AdAnalysis = z.infer<typeof adAnalysisSchema>;

// 第二轮调用产出的营销策略维度——喂给它的是第一轮 adAnalysisSchema 的结果（格式化成文本），
// 不是原始素材内容，所以这个 schema 里的字段都是"基于已知调性/游戏信息给出的策略建议"，不再需要看图/看视频
export const adStrategySchema = z.object({
  visualToneGuide: z
    .object({
      colorTendency: z.string().describe("色彩倾向"),
      graphicLanguage: z.string().describe("图形语言"),
      brandVisualGuidelines: z.string().describe("品牌视觉规范"),
      referenceStyleSamples: z.array(z.string()).describe("参考风格样本描述（不是真实图片链接，是文字描述的风格参照）"),
      materials: z.string().describe("材质"),
      colorCodes: z.array(z.string()).describe("色号，给具体的十六进制色值，如 #2E3A59"),
      fontStyle: z.string().describe("字体风格"),
      manual: z.string().describe("把以上要素汇总成一份完整的定调手册全文，要求可以直接作为约束喂给 AI 生成环节使用"),
    })
    .describe("定调手册：定义整套物料的视觉底层约束"),
  emotionalTone: z
    .object({
      coreEmotion: z.string().describe("广告希望带给目标用户的核心情绪感受"),
      narrativeTendency: z.string().describe("叙事倾向"),
      brandTemperatureRange: z.string().describe("品牌温度区间，比如在'温暖亲和'到'专业克制'之间的具体定位"),
    })
    .describe("先提炼、再定义核心情绪感受，约束后续全部素材的情绪走向"),
  audiovisualStyle: z
    .object({
      artStyle: z.string().describe("美术风格"),
      artForm: z.string().describe("艺术形式"),
      artElements: z.array(z.string()).describe("艺术元素"),
      visualTexture: z.string().describe("画面质感"),
      voiceover: z.string().describe("配音风格建议"),
      musicStyle: z.string().describe("配乐曲风"),
      soundEffectSystem: z.string().describe("音效体系"),
    })
    .describe("视频画面+音频的整体综合风格，统一整套广告的视听语言"),
  materialPlanning: z
    .object({
      materialTypes: z.array(z.string()).describe("建议规划的物料类型"),
      channelSpecs: z.array(z.object({ channel: z.string().describe("渠道"), format: z.string().describe("该渠道对应的画幅规格") })),
      schedule: z
        .string()
        .describe("上线排期建议，给阶段性描述（如'预热期/正式投放期/长尾期'的先后顺序和重点），不要编造具体日历日期——素材本身不包含真实档期信息"),
    })
    .describe("根据宣发目标规划物料矩阵"),
  materialObjectives: z
    .object({
      subGoals: z
        .array(z.object({ goal: z.string().describe("细分目标"), category: z.enum(["test", "commercial"]).describe("测试目标还是商业转化目标") }))
        .describe("单套/单批次物料要达成的细分目标，如心智传递、测试人群、提升完播、拉动转化"),
      videoDataKPIs: z
        .array(z.string())
        .describe(
          "建议关注的视频数据 KPI 维度（如自然曝光、投放后曝光、CTR、CVR、ROI、CPA、完播率、完播百分百、点赞数、评论数、转发数、评论/弹幕正向情绪占比等），" +
            "只给维度名称，不编造具体数值目标——素材本身不包含真实投放数据",
        ),
    })
    .describe("把商业目标拆解为可量化的阶段性关注维度"),
  derivativeFission: z
    .object({
      supportsSecondaryEditing: z.boolean().describe("是否支持二次剪辑、切片衍生、二创改编"),
      derivativeIdeas: z.array(z.string()).describe("衍生短视频/切片素材的方向建议，保持简单，不用展开成完整方案"),
    })
    .describe("评估该广告创意是否支持衍生裂变、拓展流量入口，输出保持极其简单"),
  regionalFission: z
    .array(
      z.object({
        region: z.string().describe("国家/地区"),
        culturalSymbols: z.string().describe("文化符号"),
        aesthetics: z.string().describe("审美偏好"),
        copywritingTone: z.string().describe("话术风格"),
        taboos: z.string().describe("禁忌"),
        complianceNotes: z.string().describe("合规差异"),
      }),
    )
    .describe("针对不同国家/地区给出创意本地化改造方向，挑 3-5 个有代表性的地区即可，实现一套母创意多地区适配"),
  userResearchDimensions: z
    .object({
      feedbackChannels: z.array(z.string()).describe("投放后应该采集用户反馈的渠道，如用户评论、问卷反馈"),
      attentionFactors: z
        .array(z.object({ dimension: z.string().describe("吸引力维度，如美术风格、故事、音频、人物美感"), rationale: z.string().describe("为什么这个维度值得关注") }))
        .describe("单个物料的吸引力维度分析，按对用户喜爱度/期待度/购买欲望的影响排序"),
    })
    .describe("定义素材投放后需要采集哪些用户反馈维度，用于反向迭代策略"),
  reviewDataDimensions: z
    .object({
      abTestMetrics: z.array(z.string()).describe("预设的 A/B 测试数据观测指标"),
      qualityCriteria: z.array(z.string()).describe("明确哪些数据用来判断这条创意的好坏"),
    })
    .describe("支持策略、素材迭代调优的复盘数据维度"),
});

export type AdStrategy = z.infer<typeof adStrategySchema>;

// 最终持久化 / 对外的 "ads[] 条目" 形状（架构文档里定义的）
export interface AdEntry extends AdAnalysis, AdStrategy {
  id: string;
  sourceType: ("video" | "image" | "text")[]; // 一条素材现在可以同时包含多种类型，不再是单值
  hasVisualAsset: boolean;
  // 代码从 tileCandidateFrameIndices 映射出的实际帧文件名；老数据没有这个字段，消费方都要按可能是 undefined 处理
  tileCandidates?: string[];
}
