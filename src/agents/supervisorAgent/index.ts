import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { supervisionResultSchema, type SupervisionResult } from "./schema";
import { SYSTEM_PROMPT, buildSupervisionMessages } from "./prompt";

const MODEL_KEY = "anthropic:claude-opus-4-8";

export interface SupervisionOutcome extends SupervisionResult {
  bridgeCutId: number;
}

function resolveOssPath(relPath: string): string {
  return u.getPath(["oss", relPath]);
}

/** 代码层面的产物存在性检查——客观可判断的问题不该花一次模型调用 */
function codePreCheck(cutType: string, filePath: string | null): string[] {
  if (!filePath) return ["没有找到已选定的最终产物"];
  const absPath = resolveOssPath(filePath);
  if (cutType === "playableGame") {
    const indexPath = path.join(absPath, "index.html");
    if (!fs.existsSync(indexPath)) return [`游戏包缺少 index.html: ${filePath}/index.html`];
    return [];
  }
  if (!fs.existsSync(absPath)) return [`产物文件不存在: ${filePath}`];
  if (fs.statSync(absPath).size === 0) return [`产物文件为空: ${filePath}`];
  return [];
}

/**
 * 按 cut 直接终审，不强制"一份方案唯一一个 cut"这条正式路径的不变量——
 * 和 assembler.ts 的 assembleCut/assemble 是同一个拆分思路，方便对 legacy 多 cut 测试数据单独验证。
 */
export async function runSupervisionForCut(bridgeCutId: number): Promise<SupervisionOutcome> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.type == null || cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 数据不完整`);
  const cutType = cut.type;

  const finalSegment = await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").where("isSelected", 1).first();

  const preCheckIssues = codePreCheck(cutType, finalSegment?.filePath ?? null);
  if (preCheckIssues.length > 0) {
    return {
      bridgeCutId,
      contentCompliance: 0,
      brandSafety: 0,
      technicalSpec: 0,
      passed: false,
      issues: preCheckIssues,
      feedback: "产物文件检查未通过，未调用模型审核。",
    };
  }

  const { episodeId, episodeAnalysis, ad } = await loadPlanContext(cut.creativePlanId);

  // video 类型复用 Stage A 的草案图做审核依据，不为了终审重新抽帧；ctaCard 直接用产物图；playableGame 无图，只看配置
  let imageRelPath: string | null = null;
  if (cutType === "video") {
    const draftSegment = await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "draftImage").where("isSelected", 1).first();
    imageRelPath = draftSegment?.filePath ?? null;
  } else if (cutType === "ctaCard") {
    imageRelPath = finalSegment?.filePath ?? null;
  }

  const messages = buildSupervisionMessages(
    episodeAnalysis,
    ad,
    { type: cutType, scriptText: cut.scriptText ?? null, prompt: cut.prompt ?? null, durationMs: cut.durationMs ?? null },
    imageRelPath ? resolveOssPath(imageRelPath) : null,
  );

  const { object } = await u.Ai.Text(MODEL_KEY).invokeObject(
    { schema: supervisionResultSchema, system: SYSTEM_PROMPT, messages },
    { taskClass: "supervision", describe: `Episode ${episodeId} cut ${bridgeCutId} 落地终审`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );

  return { bridgeCutId, ...object };
}

/** 正式路径：一份已批准方案永远只对应一个 cut，校验这条不变量后再终审 */
export async function runSupervision(creativePlanId: number): Promise<SupervisionOutcome> {
  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
  if (cuts.length !== 1) throw new Error(`创意方案 ${creativePlanId} 应该只有一个内容 cut，实际 ${cuts.length} 个`);
  const cutId = cuts[0].id;
  if (cutId == null) throw new Error(`Cut 数据不完整`);
  return runSupervisionForCut(cutId);
}
