import u from "@/utils";

/**
 * 图片生成模型的可选项——gpt-image-2 中转（napi.moretoken.ai）不稳定，
 * grsai 中转的 nano-banana-2（Gemini 图片模型）是备选，两边接口都已经真实验证过能用。
 * 用户在内容生成前选一次，选定后写进 ab_creativePlan.imageModelKey，这份方案下所有
 * 分镜草案/游戏素材生成（包括后续 revise）都读这一列，不用每次调用各自决定。
 */
export const IMAGE_MODEL_OPTIONS = [
  { key: "openai:gpt-image-2", label: "GPT Image 2" },
  { key: "grsai:nano-banana-2", label: "Gemini (Nano Banana 2)" },
] as const;

export type ImageModelKey = (typeof IMAGE_MODEL_OPTIONS)[number]["key"];

export const DEFAULT_IMAGE_MODEL_KEY: ImageModelKey = "openai:gpt-image-2";

export function isValidImageModelKey(key: string): key is ImageModelKey {
  return IMAGE_MODEL_OPTIONS.some((option) => option.key === key);
}

/** 老数据/没选过的方案没有这一列，回退到系统默认，不强制用户必须选 */
export async function resolveImageModelKey(creativePlanId: number): Promise<`${string}:${string}`> {
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  const key = plan?.imageModelKey;
  return (key && isValidImageModelKey(key) ? key : DEFAULT_IMAGE_MODEL_KEY) as `${string}:${string}`;
}
