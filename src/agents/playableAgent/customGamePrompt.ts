import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { GameSpec } from "./customGameSchema";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, narrative: string, tone: string): string {
  return [
    `## 已批准的创意方向\n构思：${narrative}\n基调：${tone}`,
    `## Episode 结尾基调\n${episodeAnalysis.endingState.summary}（建议基调：${episodeAnalysis.endingState.suggestedTone}）`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n核心玩法：${ad.game.coreMechanic}\n视觉风格：${ad.game.visualStyle}\n调性：${ad.tone}`,
  ].join("\n\n");
}

export function buildGameSpecMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, narrative: string, tone: string, userDescription: string): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad, narrative, tone)}\n\n## 用户想要的玩法描述\n${userDescription}\n\n` +
    `请把用户的描述展开/整理成一份具体、可执行的游戏设计规格，通关条件要写得具体、可判定，不要含糊。用户已经写清楚的细节要原样保留，不要简化或丢失。` +
    `只有用户没提到的细节，才参考广告信息里的核心玩法和视觉风格补充合理的默认值，不要凭空编造和用户描述无关的玩法内容——` +
    `但凡做了这类假设，都要在 assumptions 里如实列出来，不要悄悄替用户做决定却不说。`;
  return [{ role: "user", content: text }];
}

function formatSpec(spec: GameSpec): string {
  const assetLines = spec.assetsNeeded.length
    ? spec.assetsNeeded.map((a, i) => `- 素材${i + 1}：${a.description}（需要 ${a.count} 张）`).join("\n")
    : "（不需要额外图片素材）";
  return [
    `玩法类型：${spec.gameType}`,
    `通关条件：${spec.objective}`,
    `界面/棋盘结构：${spec.boardLayout}`,
    `交互规则：${spec.interactionRules}`,
    `需要的素材：\n${assetLines}`,
  ].join("\n");
}

export function buildGameCodeMessages(spec: GameSpec, assetUrls: string[], priorError?: string): ModelMessage[] {
  const assetList = assetUrls.length ? assetUrls.map((url, i) => `- 素材图 ${i + 1}：${url}`).join("\n") : "（这个游戏不需要图片素材）";
  const retryNote = priorError ? `\n\n## 上一次生成失败的原因\n${priorError}\n请修正这个问题，不要重复同样的错误。` : "";
  const text =
    `## 游戏设计规格\n${formatSpec(spec)}\n\n## 可用素材图\n${assetList}${retryNote}\n\n` +
    `请据此生成一个完整、自包含的单文件 HTML 游戏（内嵌所有 CSS 和 JS，不引用任何外部文件或 CDN），要求：\n` +
    `1. 只输出这一个 HTML 文件的完整代码，不要有任何解释性文字、不要用 markdown 代码块包裹；\n` +
    `2. 如果需要用到上面列出的素材图，直接用 <img src="实际URL"> 引用，不要引用不存在的本地路径；\n` +
    `3. 玩家真正满足通关条件时，必须调用 parent.postMessage({type:"game_complete"}, "*")；页面加载完成、可以开始交互时调用 parent.postMessage({type:"game_ready"}, "*")；\n` +
    `4. 界面要适配手机竖屏（375px 宽左右），不要有明显溢出或错位；\n` +
    `5. 只实现规格里描述的这一种玩法，不要额外发挥、不要编造规格之外的功能。`;
  return [{ role: "user", content: text }];
}
