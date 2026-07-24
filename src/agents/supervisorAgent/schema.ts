import { z } from "zod";

export const supervisionResultSchema = z.object({
  contentCompliance: z.number().min(0).max(100).describe("内容合规打分：是否存在违规/敏感内容"),
  brandSafety: z.number().min(0).max(100).describe("品牌安全打分：是否可能损害广告主品牌形象"),
  technicalSpec: z.number().min(0).max(100).describe("输出技术规格打分：产物是否完整可用（画面/文案/链接等要素齐全）"),
  passed: z.boolean().describe("是否通过终审——这是真正的拦截判定，不通过会打回内容环节要求重新生成"),
  issues: z.array(z.string()).describe("发现的问题列表，未通过时必须给出至少一条，通过时可以为空数组"),
  feedback: z.string().describe("一句话终审意见"),
});

export type SupervisionResult = z.infer<typeof supervisionResultSchema>;
