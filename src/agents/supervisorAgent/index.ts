import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { supervisionResultSchema, type SupervisionResult } from "./schema";
import { buildSupervisionMessages } from "./prompt";

const MODEL_KEY = "anthropic:claude-opus-4-8";

export interface SupervisionOutcome extends SupervisionResult {
  bridgeCutId: number;
}

function resolveOssPath(relPath: string): string {
  return u.getPath(["oss", relPath]);
}

/**
 * 在组装好的游戏包目录（.../playable/game）里找一张能代表游戏画面的素材图，返回相对 assets/ 的路径——
 * 默认翻牌配对是 assets/tiles/tile_src_N.*，「自定义玩法生成」产出的游戏是 assets/ 下直接的 custom_N.png，
 * 两种命名约定都要认，不然自定义游戏永远会被当成"缺素材"卡在终审前的代码检查这一步。
 */
function findRepresentativeAssetRelPath(gameDir: string): string | null {
  const tilesDir = path.join(gameDir, "assets", "tiles");
  if (fs.existsSync(tilesDir)) {
    const tileFile = fs.readdirSync(tilesDir).find((f) => /^tile_src_\d+\.(png|jpe?g)$/i.test(f));
    if (tileFile) return `tiles/${tileFile}`;
  }
  const assetsDir = path.join(gameDir, "assets");
  if (fs.existsSync(assetsDir)) {
    const customFile = fs.readdirSync(assetsDir).find((f) => /^custom_\d+\.(png|jpe?g)$/i.test(f));
    if (customFile) return customFile;
  }
  return null;
}

/** 代码层面的产物存在性检查——客观可判断的问题不该花一次模型调用 */
function codePreCheck(cutType: string, filePath: string | null): string[] {
  if (!filePath) return ["没有找到已选定的最终产物"];
  const absPath = resolveOssPath(filePath);
  if (cutType === "playableGame") {
    const issues: string[] = [];
    if (!fs.existsSync(path.join(absPath, "index.html"))) issues.push(`游戏包缺少 index.html: ${filePath}/index.html`);
    if (!fs.existsSync(path.join(absPath, "game", "index.html"))) issues.push(`游戏包缺少 game/index.html: ${filePath}/game/index.html`);
    if (!findRepresentativeAssetRelPath(path.join(absPath, "game"))) issues.push(`游戏包缺少配对素材图: ${filePath}/game/assets/`);
    return issues;
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

  const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);

  // video 类型复用 Stage A 的草案图做审核依据，不为了终审重新抽帧；
  // playableGame 类型取组装时用的第一张配对素材图（真实截图或 AI 生成），让终审也能看到实际画面
  let imageRelPath: string | null = null;
  if (cutType === "video") {
    const draftSegment = await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "draftImage").where("isSelected", 1).first();
    imageRelPath = draftSegment?.filePath ?? null;
  } else if (cutType === "playableGame" && finalSegment?.filePath) {
    const assetRelPath = findRepresentativeAssetRelPath(path.join(resolveOssPath(finalSegment.filePath), "game"));
    imageRelPath = assetRelPath ? `${finalSegment.filePath}/game/assets/${assetRelPath}` : null;
  }

  const messages = buildSupervisionMessages(
    episodeAnalysis,
    ad,
    narrative,
    tone,
    { type: cutType, scriptText: cut.scriptText ?? null, prompt: cut.prompt ?? null, durationMs: cut.durationMs ?? null },
    imageRelPath ? resolveOssPath(imageRelPath) : null,
  );

  const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "supervisor_agent.md"), "utf-8");
  const { object } = await u.Ai.Text(MODEL_KEY).invokeObject(
    { schema: supervisionResultSchema, system: systemPrompt, messages },
    { taskClass: "supervision", describe: `Episode ${episodeId} cut ${bridgeCutId} 落地终审`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );

  return { bridgeCutId, ...object };
}

/** 正式路径：M7 起固定两段式管线，落地终审只看 playableGame 段——它是唯一真正的最终交付物，video 段只是被嵌进它里面的过渡素材 */
export async function runSupervision(creativePlanId: number): Promise<SupervisionOutcome> {
  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId);
  const cut = cuts.find((c: any) => c.type === "playableGame");
  if (!cut?.id) throw new Error(`创意方案 ${creativePlanId} 缺少 playableGame cut`);
  return runSupervisionForCut(cut.id);
}
