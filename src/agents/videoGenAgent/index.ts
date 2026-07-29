import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { stageADraftSchema, type StageADraft, type BridgeVideoEvaluation } from "./schema";
import { buildStageADraftMessages, buildReviseMessages, buildMotionReviseMessages, assembleStageAPrompt, assembleStageBPrompt } from "./prompt";
import { evaluateDraft, evaluateRender } from "./evaluator";
import { recordRevise } from "@/agents/shared/reviseHistory";

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";
const IMAGE_MODEL_KEY = "openai:gpt-image-1";
const VIDEO_MODEL_KEY = "imarouter:seedance-2.0";
const STAGE_B_DURATION_S = 6;

export interface DraftCutResult {
  bridgeCutId: number;
  draft: StageADraft;
  assembledPrompt: string;
  imageUrl: string;
  evaluation: BridgeVideoEvaluation;
}

export interface RenderResult {
  bridgeCutId: number;
  videoUrl: string;
  durationMs: number;
  evaluation: BridgeVideoEvaluation;
}

function fileToBase64(absPath: string): string {
  return fs.readFileSync(absPath).toString("base64");
}

/** Episode 结尾最后一帧：StoryboardAgent（M1）已经抽好，优先用最贴近片尾的一帧 */
function findEpisodeLastFrame(episodeId: number): string | null {
  const candidates = ["frame_last.jpg", "frame_near_end.jpg"].map((f) => u.getPath(["episode", String(episodeId), "frames", f]));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** 广告素材的代表性参考图：视频广告取 AdLibraryAgent（M1）抽帧里的第一张，图片广告直接用原图，文案广告没有视觉素材 */
function findAdReferenceFrame(adId: number, adType: string | null, sourceFilePath: string | null): string | null {
  if (adType === "image") return sourceFilePath && fs.existsSync(sourceFilePath) ? sourceFilePath : null;
  if (adType === "video") {
    const framesDir = u.getPath(["ad", String(adId), "frames"]);
    if (!fs.existsSync(framesDir)) return null;
    const files = fs
      .readdirSync(framesDir)
      .filter((f) => /^frame_\d+\.jpg$/.test(f))
      .sort();
    return files.length > 0 ? path.join(framesDir, files[0]) : null;
  }
  return null;
}

interface ReferenceBundle {
  refs: { type: "image"; base64: string }[];
  hasEpisodeFrame: boolean;
  hasAdFrame: boolean;
}

async function buildReferenceList(episodeId: number, adId: number): Promise<ReferenceBundle> {
  const adRow = await u.db("ab_ad").where("id", adId).first();
  const refs: { type: "image"; base64: string }[] = [];
  const episodeFrame = findEpisodeLastFrame(episodeId);
  if (episodeFrame) refs.push({ type: "image", base64: fileToBase64(episodeFrame) });
  const adFrame = findAdReferenceFrame(adId, adRow?.adType ?? null, adRow?.sourceFilePath ?? null);
  if (adFrame) refs.push({ type: "image", base64: fileToBase64(adFrame) });
  return { refs, hasEpisodeFrame: episodeFrame != null, hasAdFrame: adFrame != null };
}

async function renderDraftImage(bridgeCutId: number, episodeId: number, adId: number, draft: StageADraft): Promise<{ imageUrl: string; assembledPrompt: string }> {
  const { refs, hasEpisodeFrame, hasAdFrame } = await buildReferenceList(episodeId, adId);
  const assembledPrompt = assembleStageAPrompt(draft, hasEpisodeFrame, hasAdFrame);
  const relPath = `bridgeCut/${bridgeCutId}/draft-${Date.now()}.png`;
  const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
    {
      prompt: assembledPrompt,
      referenceList: refs.length > 0 ? refs : undefined,
      size: "1K",
      aspectRatio: "9:16",
    },
    { taskClass: "videoGen-stageA-draftImage", describe: `Cut ${bridgeCutId} 分镜草案图`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );
  await image.save(relPath);

  await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "draftImage").update({ isSelected: 0 });
  await u.db("ab_generatedSegment").insert({
    bridgeCutId,
    model: IMAGE_MODEL_KEY,
    filePath: relPath,
    state: "done",
    stage: "draftImage",
    isSelected: 1,
    createTime: Date.now(),
  });
  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ scriptText: JSON.stringify(draft), prompt: assembledPrompt, status: "draft" });

  return { imageUrl: await u.oss.getFileUrl(relPath), assembledPrompt };
}

export async function generateDraftCut(bridgeCutId: number): Promise<DraftCutResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.type !== "video") throw new Error(`Cut ${bridgeCutId} 类型是 ${cut.type}，不是 video，不能走 VideoGenAgent`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);

  try {
    const { episodeId, adId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
    const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "video_gen_agent.md"), "utf-8");
    const { object: draft } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: stageADraftSchema,
        system: systemPrompt,
        messages: buildStageADraftMessages(episodeAnalysis, ad, narrative, tone),
      },
      { taskClass: "videoGen-stageA-draftText", describe: `Cut ${bridgeCutId} 分镜草案文案`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const evaluation = await evaluateDraft(draft);
    const { imageUrl, assembledPrompt } = await renderDraftImage(bridgeCutId, episodeId, adId, draft);
    return { bridgeCutId, draft, assembledPrompt, imageUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

export async function reviseDraftCut(bridgeCutId: number, feedback: string): Promise<DraftCutResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.type !== "video") throw new Error(`Cut ${bridgeCutId} 类型是 ${cut.type}，不是 video，不能走 VideoGenAgent`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
  if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 还没有生成过草案，不能 revise`);

  try {
    const { episodeId, adId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
    const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "video_gen_agent.md"), "utf-8");
    const existing = JSON.parse(cut.scriptText) as StageADraft;
    const { object: draft } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: stageADraftSchema,
        system: systemPrompt,
        messages: buildReviseMessages(episodeAnalysis, ad, narrative, tone, existing, feedback),
      },
      { taskClass: "videoGen-stageA-reviseText", describe: `Cut ${bridgeCutId} 分镜草案 revise`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const evaluation = await evaluateDraft(draft);
    const { imageUrl, assembledPrompt } = await renderDraftImage(bridgeCutId, episodeId, adId, draft);
    await recordRevise("bridgeCutDraft", bridgeCutId, feedback, existing, draft);
    return { bridgeCutId, draft, assembledPrompt, imageUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

/** 确定性守卫：这份方案下所有 video 类型的 cut 都要有已选定的草案图才能通过，全部通过才推进，不部分推进 */
export async function confirmAllCuts(creativePlanId: number): Promise<void> {
  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId).where("type", "video");
  if (cuts.length === 0) throw new Error(`创意方案 ${creativePlanId} 没有需要确认的分镜草案`);

  const notReady = cuts.filter((c: any) => c.status !== "draft");
  if (notReady.length > 0) throw new Error(`以下分镜草案还没准备好确认: ${notReady.map((c: any) => c.id).join(", ")}`);

  for (const cut of cuts) {
    const selected = await u.db("ab_generatedSegment").where("bridgeCutId", cut.id).where("stage", "draftImage").where("isSelected", 1).first();
    if (!selected) throw new Error(`分镜草案 ${cut.id} 没有已选定的草案图`);
  }

  await u.db("ab_bridgeCut")
    .whereIn(
      "id",
      cuts.map((c: any) => c.id),
    )
    .update({ status: "draftConfirmed" });
}

/** Stage B 渲染的共用部分：调 Seedance、存新 finalRender 段、把 cut 标记完成——渲染入口(draftConfirmed→done)和运镜专用 revise(done→done)都走这里 */
async function performStageBRender(bridgeCutId: number, creativePlanId: number, draft: StageADraft): Promise<RenderResult> {
  const draftSegment = await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "draftImage").where("isSelected", 1).first();
  if (!draftSegment?.filePath) throw new Error(`Cut ${bridgeCutId} 没有已选定的草案图`);
  const draftImageBase64 = (await u.oss.getFile(draftSegment.filePath)).toString("base64");
  const plan = await u.db("ab_creativePlan").where("id", creativePlanId).first();
  if (plan?.episodeId == null) throw new Error(`Cut ${bridgeCutId} 反查不到 episodeId`);
  const episodeId = plan.episodeId;

  const video = await u.Ai.Video(VIDEO_MODEL_KEY).run(
    {
      duration: STAGE_B_DURATION_S,
      resolution: "1080p",
      aspectRatio: "9:16",
      prompt: assembleStageBPrompt(draft),
      referenceList: [{ type: "image", base64: draftImageBase64 }],
      mode: ["singleImage"],
    },
    { taskClass: "videoGen-stageB-render", describe: `Cut ${bridgeCutId} 成片渲染`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );
  const relPath = `bridgeCut/${bridgeCutId}/render-${Date.now()}.mp4`;
  await video.save(relPath);
  const videoUrl = await u.oss.getFileUrl(relPath);
  const durationMs = STAGE_B_DURATION_S * 1000;

  const evaluation = await evaluateRender(draft, durationMs);

  await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").update({ isSelected: 0 });
  await u.db("ab_generatedSegment").insert({
    bridgeCutId,
    model: VIDEO_MODEL_KEY,
    filePath: relPath,
    state: "done",
    stage: "finalRender",
    isSelected: 1,
    createTime: Date.now(),
  });
  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "done", durationMs });

  return { bridgeCutId, videoUrl, durationMs, evaluation };
}

export async function renderStageB(bridgeCutId: number): Promise<RenderResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.status !== "draftConfirmed") throw new Error(`Cut ${bridgeCutId} 当前状态是 ${cut.status}，还没确认草案，不能渲染成片`);
  if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 缺少草案数据`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);

  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "rendering" });
  try {
    const draft = JSON.parse(cut.scriptText) as StageADraft;
    return await performStageBRender(bridgeCutId, cut.creativePlanId, draft);
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

/**
 * 只调整成片的运镜/节奏，不重新生成草案图——和 reviseDraftCut 是两条互斥的 revise 路径，由用户明确选择走哪一条
 * （session_agent_decision.md 教 SessionAgent 在反馈含糊时直接问用户，而不是替用户猜）。
 * 只允许 cameraMovement/emotionalTone 变化，其余字段强制锁定成已确认草案的原值，防止 prompt 和已生成的静态图对不上。
 */
export async function reviseStageBMotion(bridgeCutId: number, feedback: string): Promise<RenderResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.type !== "video") throw new Error(`Cut ${bridgeCutId} 类型是 ${cut.type}，不是 video，不能走 VideoGenAgent`);
  if (cut.status !== "done") throw new Error(`Cut ${bridgeCutId} 当前状态是 ${cut.status}，还没有成片，不能调整运镜`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
  if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 缺少草案数据`);

  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "rendering" });
  try {
    const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
    const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "video_gen_agent.md"), "utf-8");
    const existing = JSON.parse(cut.scriptText) as StageADraft;
    const { object: draft } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: stageADraftSchema,
        system: systemPrompt,
        messages: buildMotionReviseMessages(episodeAnalysis, ad, narrative, tone, existing, feedback),
      },
      { taskClass: "videoGen-stageB-motionRevise", describe: `Cut ${bridgeCutId} 运镜/节奏调整`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const constrainedDraft: StageADraft = { ...existing, cameraMovement: draft.cameraMovement, emotionalTone: draft.emotionalTone };
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ scriptText: JSON.stringify(constrainedDraft) });
    const result = await performStageBRender(bridgeCutId, cut.creativePlanId, constrainedDraft);
    await recordRevise("bridgeCutMotion", bridgeCutId, feedback, existing, constrainedDraft);
    return result;
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}
