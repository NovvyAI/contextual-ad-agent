// 兼容新旧两种 ab_ad 存储方式：老记录只有单值 adType+sourceFilePath（互斥的单一类型），
// 新记录改用 imageFilePath/videoFilePath 两个独立字段（可以同时非空，支持一条素材多种类型）。
// AdLibraryAgent.analyzeAd() 和 VideoGenAgent 挑参考图这两处都要解析"这条素材实际的图片/视频文件路径"，
// 用同一套规则，不然两处判断标准不一致，产出的分析和参考图会对不上。
interface AdRowLike {
  imageFilePath?: string | null;
  videoFilePath?: string | null;
  adType?: string | null;
  sourceFilePath?: string | null;
}

export function resolveAdImagePath(ad: AdRowLike): string | null {
  return ad.imageFilePath ?? (ad.adType === "image" ? (ad.sourceFilePath ?? null) : null);
}

export function resolveAdVideoPath(ad: AdRowLike): string | null {
  return ad.videoFilePath ?? (ad.adType === "video" ? (ad.sourceFilePath ?? null) : null);
}
