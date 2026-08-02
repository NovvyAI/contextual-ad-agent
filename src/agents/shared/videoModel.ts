import u from "@/utils";

/**
 * 视频生成模型的可选项——和 imageModel.ts 是同一个思路。Seedance 中转（ImaRouter）是原来一直用的，
 * Veo 3.1（Google 官方直连）是备选：技术上支持图生视频，但用参考图时官方强制要求 8 秒时长
 * （没有 6-15 秒自由发挥的空间），选它就是接受这个时长被锁定的取舍，label 里直接写明。
 * 用户在内容生成前选一次，选定后写进 ab_creativePlan.videoModelKey，这份方案下所有
 * 分镜成片渲染（包括运镜专用 revise）都读这一列，不用每次调用各自决定。
 */
export const VIDEO_MODEL_OPTIONS = [
  { key: "imarouter:seedance-2.0", label: "Seedance 2.0" },
  { key: "google:veo-3.1-generate-preview", label: "Veo 3.1（官方直连，固定8秒）" },
] as const;

export type VideoModelKey = (typeof VIDEO_MODEL_OPTIONS)[number]["key"];

export const DEFAULT_VIDEO_MODEL_KEY: VideoModelKey = "imarouter:seedance-2.0";

export function isValidVideoModelKey(key: string): key is VideoModelKey {
  return VIDEO_MODEL_OPTIONS.some((option) => option.key === key);
}

/** 老数据/没选过的方案没有这一列，回退到系统默认，不强制用户必须选 */
export async function resolveVideoModelKey(creativePlanId: number): Promise<`${string}:${string}`> {
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  const key = plan?.videoModelKey;
  return (key && isValidVideoModelKey(key) ? key : DEFAULT_VIDEO_MODEL_KEY) as `${string}:${string}`;
}
