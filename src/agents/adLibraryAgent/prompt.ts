import type { ModelMessage } from "ai";
import type { AdAnalysis } from "./schema";

// 第二轮调用只喂第一轮分析结果的文本（不再看图/看视频），产出建立在已知调性/游戏信息之上的营销策略维度
export function buildStrategyMessages(base: AdAnalysis, presentTypes: string[]): ModelMessage[] {
  const text = [
    `## 素材类型\n${presentTypes.join("、")}`,
    `## 已完成的基础分析\n调性：${base.tone}\n游戏：${base.game.name}（${base.game.genre}）\n核心玩法：${base.game.coreMechanic}\n视觉风格：${base.game.visualStyle}\n核心卖点：${base.game.keySellingPoints.join("、")}\n摘要：${base.summary}`,
    "请基于以上信息，产出这条广告素材的营销策略分析。",
  ].join("\n\n");
  return [{ role: "user", content: text }];
}
