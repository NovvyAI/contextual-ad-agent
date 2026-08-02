import u from "@/utils";

/**
 * 成片分辨率的可选项——和 imageModel.ts/videoModel.ts 是同一个思路。只给两个视频供应商都支持的
 * 交集（Seedance 支持 480p/720p/1080p，Veo 支持 720p/1080p/4K），不放 480p/4K 这种只有一边支持
 * 的档位，避免"选了 Veo 却调了 Seedance 独有的分辨率"这类无效组合——不做成"下拉框选项跟着视频模型
 * 联动变化"这种更复杂的交互，简单直接更不容易出错。
 */
export const VIDEO_RESOLUTION_OPTIONS = [
  { key: "1080p", label: "1080p" },
  { key: "720p", label: "720p" },
] as const;

export type VideoResolution = (typeof VIDEO_RESOLUTION_OPTIONS)[number]["key"];

export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = "1080p";

export function isValidVideoResolution(value: string): value is VideoResolution {
  return VIDEO_RESOLUTION_OPTIONS.some((option) => option.key === value);
}

/** 老数据/没选过的方案没有这一列，回退到系统默认（原来一直硬编码用的 1080p），不强制用户必须选 */
export async function resolveVideoResolution(creativePlanId: number): Promise<VideoResolution> {
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  const value = plan?.videoResolution;
  return value && isValidVideoResolution(value) ? value : DEFAULT_VIDEO_RESOLUTION;
}
