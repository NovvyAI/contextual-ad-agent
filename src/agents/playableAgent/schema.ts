import { z } from "zod";

export const playableConfigSchema = z.object({
  title: z.string().describe("互动小游戏标题，也是片尾结束卡上显示的标题"),
  ctaUrl: z.string().describe("跳转链接（商品页/落地页），从广告信息里取，没有真实链接时用广告方案里的占位链接"),
  tilePrompts: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("配对游戏用的图片素材 prompt 列表（2-6 张不同的图，会循环填满棋盘格子），应体现产品卖点或品牌视觉元素"),
});

export type PlayableConfig = z.infer<typeof playableConfigSchema>;
