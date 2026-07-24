import { z } from "zod";

// 这是 LLM 要返回的部分——id/sourceType/hasVisualAsset 由代码这边算，不问模型要
export const adAnalysisSchema = z.object({
  tone: z.string().describe("广告调性/风格，如：幽默、温情、专业、刺激"),
  product: z.object({
    name: z.string().describe("产品/品牌名称"),
    category: z.string().optional().describe("产品品类"),
    keySellingPoints: z.array(z.string()).describe("核心卖点列表"),
  }),
  brandSafety: z.object({
    isSafe: z.boolean().describe("是否通过品牌安全检查（无暴力、无争议内容等）"),
    concerns: z.array(z.string()).describe("潜在风险点列表，若无风险则为空数组"),
  }),
  summary: z.string().describe("素材内容摘要"),
});

export type AdAnalysis = z.infer<typeof adAnalysisSchema>;

// 最终持久化 / 对外的 "ads[] 条目" 形状（架构文档里定义的）
export interface AdEntry extends AdAnalysis {
  id: string;
  sourceType: "video" | "image" | "text";
  hasVisualAsset: boolean;
}
