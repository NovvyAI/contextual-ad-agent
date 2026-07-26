import fs from "fs";
import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";

export const SYSTEM_PROMPT =
  "你是短剧广告桥接系统的落地终审（SupervisorAgent）。这是内容正式交付前的最后一道关卡，" +
  "和之前各环节的参考性打分不一样——你的判定是真正的拦截：不通过就要打回内容环节重新生成，不能含糊。\n" +
  "审核维度：\n" +
  "1. 内容合规——有没有违规、敏感、误导性内容。\n" +
  "2. 品牌安全——是否可能损害广告主的品牌形象，结合广告方分析阶段已经给出的品牌安全信息判断。\n" +
  "3. 输出技术规格——产物本身是否完整可用（画面/文案/跳转链接等要素齐全，不是半成品）。\n" +
  "三项任意一项有明显问题都应该判定不通过，并在 issues 里给出具体、可操作的问题描述，方便用户知道该改什么。";

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry): string {
  return [
    `## Episode 结尾状态\n${episodeAnalysis.endingState.summary}`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n调性：${ad.tone}\n` +
      `AdLibraryAgent 阶段的品牌安全评估：isSafe=${ad.brandSafety.isSafe}${ad.brandSafety.concerns.length ? `，关注点：${ad.brandSafety.concerns.join("、")}` : ""}`,
  ].join("\n\n");
}

function formatCut(cut: { type: string; scriptText: string | null; prompt: string | null; durationMs: number | null }): string {
  const lines = [`类型：${cut.type}`];
  if (cut.scriptText) lines.push(`内容配置：${cut.scriptText}`);
  if (cut.prompt) lines.push(`生成 prompt：${cut.prompt}`);
  if (cut.durationMs) lines.push(`时长：${(cut.durationMs / 1000).toFixed(1)}秒`);
  return lines.join("\n");
}

export function buildSupervisionMessages(
  episodeAnalysis: EpisodeAnalysis,
  ad: AdEntry,
  cut: { type: string; scriptText: string | null; prompt: string | null; durationMs: number | null },
  imageAbsPath: string | null,
): ModelMessage[] {
  const text = `${formatContext(episodeAnalysis, ad)}\n\n## 待终审内容\n${formatCut(cut)}\n\n请对这份即将交付的桥接内容做落地终审。`;
  const content: any[] = [{ type: "text", text }];
  if (imageAbsPath && fs.existsSync(imageAbsPath)) {
    content.push({ type: "image", image: fs.readFileSync(imageAbsPath), mediaType: "image/png" });
  }
  return [{ role: "user", content }];
}
