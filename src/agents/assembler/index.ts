import path from "path";
import u from "@/utils";
import { concatVideos } from "@/utils/video";
import type { SupervisionOutcome } from "@/agents/supervisorAgent";

/** manifest 相关产物统一放在 OSS 下的 manifest/{episodeId}/{creativePlanId}/ 目录 */
function ossAbsPath(episodeId: number, creativePlanId: number, filename: string): string {
  return u.getPath(["oss", "manifest", String(episodeId), String(creativePlanId), filename]);
}
function ossRelPath(episodeId: number, creativePlanId: number, filename: string): string {
  return `manifest/${episodeId}/${creativePlanId}/${filename}`;
}

export interface AssembledDeliverable {
  bridgeCutId: number;
  type: string;
  finalFilePath: string; // OSS 相对路径
  kind: "video" | "playableBundle";
  assets?: { ctaUrl?: string; ctaImagePath?: string };
}

/**
 * 按 cut 的 type 两分支组装交付物，纯代码无 LLM。
 * 单独导出（不强制"固定两段 cut"这条正式路径的不变量），方便直接对某个 cut 做验证。
 */
export async function assembleCut(bridgeCutId: number): Promise<AssembledDeliverable> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.type == null || cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 数据不完整`);

  const plan = await u.db("ab_creativePlan").where("id", cut.creativePlanId).first();
  if (!plan || plan.episodeId == null) throw new Error(`创意方案 ${cut.creativePlanId} 数据不完整`);
  const episode = await u.db("ab_episode").where("id", plan.episodeId).first();
  if (!episode?.sourceFilePath) throw new Error(`Episode ${plan.episodeId} 缺少 sourceFilePath`);

  const finalSegment = await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").where("isSelected", 1).first();
  if (!finalSegment?.filePath) throw new Error(`Cut ${bridgeCutId} 没有已选定的最终产物`);

  if (cut.type === "video") {
    const bridgeVideoAbsPath = u.getPath(["oss", finalSegment.filePath]);
    const outputAbsPath = ossAbsPath(plan.episodeId, cut.creativePlanId, `final-${Date.now()}.mp4`);
    await concatVideos(episode.sourceFilePath, bridgeVideoAbsPath, outputAbsPath);
    return {
      bridgeCutId,
      type: cut.type,
      finalFilePath: ossRelPath(plan.episodeId, cut.creativePlanId, path.basename(outputAbsPath)),
      kind: "video",
    };
  }

  if (cut.type === "playableGame") {
    // PlayableAgent 在 M3 装配时已经把 Episode 尾帧塞进了游戏包自己的 bridge.mp4，产物已经是自包含的，不用再拼
    return {
      bridgeCutId,
      type: cut.type,
      finalFilePath: `${finalSegment.filePath}/index.html`,
      kind: "playableBundle",
    };
  }

  throw new Error(`未知的 cut 类型: ${cut.type}`);
}

/** 正式路径：M7 起固定两段式管线，最终交付物永远是 playableGame 段——video 段的产物已经被嵌进它里面，不再单独落地 */
export async function assemble(episodeId: number, creativePlanId: number, supervision?: SupervisionOutcome): Promise<number> {
  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
  const cut = cuts.find((c: any) => c.type === "playableGame");
  if (!cut?.id) throw new Error(`创意方案 ${creativePlanId} 缺少 playableGame cut`);
  const cutId = cut.id;

  const deliverable = await assembleCut(cutId);
  const url = await u.oss.getFileUrl(deliverable.finalFilePath);

  const manifestJson = {
    version: 1,
    bridgeCutId: deliverable.bridgeCutId,
    type: deliverable.type,
    deliverable: { filePath: deliverable.finalFilePath, url, kind: deliverable.kind },
    supervision: supervision ?? null,
    assets: deliverable.assets ?? null,
    createdAt: Date.now(),
  };

  const [id] = await u.db("ab_manifest").insert({
    episodeId,
    creativePlanId,
    finalFilePath: deliverable.finalFilePath,
    manifestJson: JSON.stringify(manifestJson),
    status: "done",
    createTime: Date.now(),
  });
  return id;
}
