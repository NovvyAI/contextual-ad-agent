import { z } from "zod";

export const gameSpecSchema = z.object({
  title: z.string().describe("互动小游戏标题，也是片尾结束卡上显示的标题"),
  ctaUrl: z.string().describe("跳转链接（商品页/落地页），从广告信息里取，没有真实链接时用广告方案里的占位链接"),
  gameType: z.string().describe("玩法类型简述，如：找不同、三消、拼豆"),
  objective: z.string().describe("玩家要做什么才算通关/获胜，要具体可判定，比如“在60秒内找出全部5处不同”"),
  boardLayout: z.string().describe("界面/棋盘的基本结构描述，比如网格大小、元素排布方式"),
  interactionRules: z.string().describe("具体的交互规则，比如怎么点击/拖拽、怎么判定成功或失败"),
  assetsNeeded: z
    .array(
      z.object({
        description: z.string().describe("这张素材图应该是什么内容"),
        count: z.number().int().min(1).describe("需要几张这种素材"),
      }),
    )
    .describe("生成这个游戏需要用到的图片素材列表，没有素材需求就返回空数组"),
  assumptions: z
    .array(z.string())
    .describe(
      "用户描述里没说清楚、你替用户做了假设/默认选择的关键点，逐条列出具体假设了什么，方便用户看到后判断要不要调整重新生成；" +
        "如果用户描述已经足够明确、没有需要假设的地方，返回空数组，不要为了填空硬凑内容。",
    ),
});

export type GameSpec = z.infer<typeof gameSpecSchema>;
