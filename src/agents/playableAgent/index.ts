import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { playableConfigSchema, type PlayableConfig } from "./schema";
import { buildGenerateMessages, buildReviseMessages } from "./prompt";
import { evaluatePlayable, type PlayableEvaluation } from "./evaluator";
import { recordRevise } from "@/agents/shared/reviseHistory";
import { gameSpecSchema, type GameSpec } from "./customGameSchema";
import { buildGameSpecMessages, buildGameSpecReviseMessages, buildGameCodeMessages } from "./customGamePrompt";
import { runGameSmokeTest } from "@/utils/gameSmokeTest";
import { acquireCutLock, releaseCutLock, cutBusyError } from "@/agents/shared/cutLock";
import { sampleFrames } from "@/utils/video";
import { zipImage } from "@/utils/vm";

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";
const IMAGE_MODEL_KEY = "openai:gpt-image-2";
const DEFAULT_PAIRS = 8; // 照搬 Python 参考实现 build_playable.py 的 DEFAULT_PAIRS

const INJECT_RE = /\/\*INJECT\*\/\{\}\/\*END\*\//;

function inject(templateHtml: string, obj: unknown): string {
  if (!INJECT_RE.test(templateHtml)) throw new Error("模板里没有找到 /*INJECT*/{}/*END*/ 标记");
  return templateHtml.replace(INJECT_RE, JSON.stringify(obj));
}

/**
 * 把用户在生成游戏前勾选的 Episode 候选帧文件名，读成参考图 base64 列表——
 * 用户可以不选（返回空数组），选中的帧不直接复制使用，只作为 u.Ai.Image referenceList 的参考图，
 * 保证生成的素材风格匹配游戏、同时保留真实角色/场景样貌。
 */
function resolveCandidateReferenceImages(episodeId: number, selectedCandidateFrames: string[]): Extract<import("@/utils/ai").ReferenceList, { type: "image" }>[] {
  return selectedCandidateFrames
    .map((filename) => u.getPath(["episode", String(episodeId), "frames", filename]))
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ type: "image" as const, base64: fs.readFileSync(p).toString("base64") }));
}

const VIDEO_REFERENCE_FRAME_COUNT = 3;

/**
 * 同方案下 video cut 已经生成好的画面——分镜草案图 + 成片抽帧（不止首帧，均匀抽 N 张）——
 * 作为自定义玩法生成素材的额外参考图，让游戏素材画风能延续视频里已经定下来的样子，不是各画各的。
 * video cut 不存在、还没生成草案、还没渲染成片都不算错，能拿到多少算多少，不阻塞主流程。
 */
async function resolveVideoCutReferenceImages(creativePlanId: number): Promise<Extract<import("@/utils/ai").ReferenceList, { type: "image" }>[]> {
  const videoCut = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId).where("type", "video").first();
  if (!videoCut) return [];

  const images: Extract<import("@/utils/ai").ReferenceList, { type: "image" }>[] = [];

  const draftSegment = await u.db("ab_generatedSegment").where("bridgeCutId", videoCut.id).where("stage", "draftImage").where("isSelected", 1).first();
  if (draftSegment?.filePath) {
    // Stage A 草案图是 gpt-image-2 直出的无损 PNG（1024x1536，未压缩前大概 2-3MB base64），
    // 当参考图只需要传达画风/构图，不需要这么大——压成 JPEG 控制在 300KB 以内，减轻请求体积，
    // 降低这类多参考图请求撞上供应商 120 秒网关超时的概率
    const rawBase64 = (await u.oss.getFile(draftSegment.filePath)).toString("base64");
    const compressedDataUri = await zipImage(`data:image/png;base64,${rawBase64}`, 300 * 1024);
    images.push({ type: "image", base64: compressedDataUri.split(",")[1] });
  }

  const renderSegment = await u.db("ab_generatedSegment").where("bridgeCutId", videoCut.id).where("stage", "finalRender").where("isSelected", 1).first();
  if (renderSegment?.filePath) {
    try {
      const localVideoPath = u.getPath(["oss", renderSegment.filePath]);
      const outDir = u.getPath(["bridgeCut", String(videoCut.id), "referenceFrames"]);
      const frames = await sampleFrames(localVideoPath, outDir, { mode: "count", count: VIDEO_REFERENCE_FRAME_COUNT, includeLast: false });
      for (const frame of frames) {
        images.push({ type: "image", base64: fs.readFileSync(frame.path).toString("base64") });
      }
    } catch (e) {
      console.error(`[playableAgent] 成片抽帧失败，跳过这部分参考图: ${u.error(e).message}`);
    }
  }

  return images;
}

export interface PlayableResult {
  bridgeCutId: number;
  config: PlayableConfig;
  previewUrl: string;
  evaluation: PlayableEvaluation;
}

/**
 * 组装出的 game/index.html 已经就绪之后的共用收尾——拷贝片头视频、注入容器页、落库。
 * 翻牌配对路径和自定义生成路径最终都汇到这里，区别只在 gameHtml 是怎么产出的。
 */
async function finalizePlayablePackage(bridgeCutId: number, creativePlanId: number, gameHtml: string, title: string, ctaUrl: string, scriptText: string, model: string): Promise<string> {
  const relDir = `bridgeCut/${bridgeCutId}/playable`;
  const containerTemplate = fs.readFileSync(u.getPath(["templates", "playable", "container.html"]), "utf-8");

  await u.oss.writeFile(`${relDir}/game/index.html`, Buffer.from(gameHtml, "utf-8"));

  // 片头视频：M7 起读取同一方案下 video 段已经渲染完成的真实过渡成片（此前是 Episode 尾帧占位，
  // 现在游戏组装是用户手动确认触发的下一步，video 段这时必然已经 done，可以直接读它的最终产物）。
  const videoCut = await u.db("ab_bridgeCut").where("creativePlanId", creativePlanId).where("type", "video").first();
  const videoSegment = videoCut?.id
    ? await u.db("ab_generatedSegment").where("bridgeCutId", videoCut.id).where("stage", "finalRender").where("isSelected", 1).first()
    : null;
  let hasVideo = false;
  if (videoSegment?.filePath) {
    await u.oss.writeFile(`${relDir}/bridge.mp4`, await u.oss.getFile(videoSegment.filePath));
    hasVideo = true;
  }

  const containerHtml = inject(containerTemplate, {
    title,
    cta_url: ctaUrl,
    app_icon: null,
    external_game: false,
    has_video: hasVideo,
    fallback_cta_after_s: 30,
  });
  await u.oss.writeFile(`${relDir}/index.html`, Buffer.from(containerHtml, "utf-8"));

  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ scriptText, status: "generating" });
  await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").update({ isSelected: 0 });
  await u.db("ab_generatedSegment").insert({
    bridgeCutId,
    model,
    filePath: relDir,
    state: "done",
    stage: "finalRender",
    isSelected: 1,
    createTime: Date.now(),
  });
  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "done" });

  return u.oss.getFileUrl(`${relDir}/index.html`);
}

async function assemble(
  bridgeCutId: number,
  episodeId: number,
  creativePlanId: number,
  adId: number,
  tileCandidates: string[],
  config: PlayableConfig,
  evaluation: PlayableEvaluation,
  referenceImages: Extract<import("@/utils/ai").ReferenceList, { type: "image" }>[] = [],
): Promise<string> {
  const relDir = `bridgeCut/${bridgeCutId}/playable`;
  const gameTemplate = fs.readFileSync(u.getPath(["templates", "playable", "game.html"]), "utf-8");

  // 配对素材：优先用 AdLibraryAgent 挑出的真实游戏截图（至少 2 张才有配对意义），
  // 否则回退到 LLM 给的 distinct prompt 各生成一张图（和 Python 参考实现的 cycle 逻辑一致）
  const tileUrls: string[] = [];
  if (tileCandidates.length >= 2) {
    for (let i = 0; i < tileCandidates.length; i++) {
      const localPath = u.getPath(["ad", String(adId), "frames", tileCandidates[i]]);
      if (!fs.existsSync(localPath)) continue;
      const relPath = `${relDir}/game/assets/tiles/tile_src_${i}.jpg`;
      await u.oss.writeFile(relPath, fs.readFileSync(localPath));
      tileUrls.push(await u.oss.getFileUrl(relPath));
    }
  }
  if (tileUrls.length < 2) {
    tileUrls.length = 0;
    for (let i = 0; i < config.tilePrompts.length; i++) {
      const relPath = `${relDir}/game/assets/tiles/tile_src_${i}.png`;
      const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
        { prompt: config.tilePrompts[i], size: "1K", aspectRatio: "1:1", referenceList: referenceImages.length > 0 ? referenceImages : undefined },
        { taskClass: "playable-tileImage", describe: `Cut ${bridgeCutId} 配对素材图 ${i}`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      await image.save(relPath);
      tileUrls.push(await u.oss.getFileUrl(relPath));
    }
  }
  const manifestTiles = Array.from({ length: DEFAULT_PAIRS }, (_, i) => tileUrls[i % tileUrls.length]);

  const gameHtml = inject(gameTemplate, { title: config.title, tiles: manifestTiles, sounds: {} });

  return finalizePlayablePackage(bridgeCutId, creativePlanId, gameHtml, config.title, config.ctaUrl, JSON.stringify(config), IMAGE_MODEL_KEY);
}

/**
 * 不带并发锁的内部实现——generateCustomGame 失败时会回退调用这个逻辑，此时锁已经被
 * generateCustomGame 自己占着，不能再用一次公开的 assemblePlayable（会自己把自己锁死）。
 */
async function assemblePlayableInner(bridgeCutId: number, selectedCandidateFrames: string[]): Promise<PlayableResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);

  try {
    const { episodeId, adId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
    const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_agent.md"), "utf-8");
    const { object: config } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: playableConfigSchema,
        system: systemPrompt,
        messages: buildGenerateMessages(episodeAnalysis, ad, narrative, tone),
      },
      { taskClass: "playable-generateText", describe: `Cut ${bridgeCutId} 小游戏配置`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const evaluation = await evaluatePlayable(config);
    const referenceImages = resolveCandidateReferenceImages(episodeId, selectedCandidateFrames);
    const previewUrl = await assemble(bridgeCutId, episodeId, cut.creativePlanId, adId, ad.tileCandidates ?? [], config, evaluation, referenceImages);
    return { bridgeCutId, config, previewUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

export async function assemblePlayable(bridgeCutId: number, selectedCandidateFrames: string[] = []): Promise<PlayableResult> {
  if (!acquireCutLock(bridgeCutId)) throw cutBusyError(bridgeCutId);
  try {
    return await assemblePlayableInner(bridgeCutId, selectedCandidateFrames);
  } finally {
    releaseCutLock(bridgeCutId);
  }
}

export async function revisePlayable(bridgeCutId: number, feedback: string): Promise<PlayableResult> {
  if (!acquireCutLock(bridgeCutId)) throw cutBusyError(bridgeCutId);
  try {
    const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
    if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
    if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
    if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 还没有生成过，不能 revise`);

    try {
      const { episodeId, adId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
      const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_agent.md"), "utf-8");
      const existing = JSON.parse(cut.scriptText) as PlayableConfig;
      const { object: config } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
        {
          schema: playableConfigSchema,
          system: systemPrompt,
          messages: buildReviseMessages(episodeAnalysis, ad, narrative, tone, existing, feedback),
        },
        { taskClass: "playable-reviseText", describe: `Cut ${bridgeCutId} 小游戏配置 revise`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      const evaluation = await evaluatePlayable(config);
      const previewUrl = await assemble(bridgeCutId, episodeId, cut.creativePlanId, adId, ad.tileCandidates ?? [], config, evaluation);
      await recordRevise("playable", bridgeCutId, feedback, existing, config);
      return { bridgeCutId, config, previewUrl, evaluation };
    } catch (e) {
      await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
      throw e;
    }
  } finally {
    releaseCutLock(bridgeCutId);
  }
}

export interface CustomGameResult {
  bridgeCutId: number;
  previewUrl: string;
  fallback: boolean;
  fallbackReason?: string;
  spec?: GameSpec;
  // fallback 时是真实的 evaluatePlayable 打分；非 fallback 时代表"通过了自动化冒烟测试"，
  // 不是内容质量分——两种含义不同，调用方展示时不能混为一谈。
  evaluatorScore: number;
  evaluatorFeedback: string;
}

const MAX_CODEGEN_ATTEMPTS = 3; // 首次 + 最多 2 次重试

function extractHtml(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * 按 GameSpec 需要的素材数量，用 gpt-image-2 按每一条具体描述单独生成。
 * 不复用 tileCandidates（AdLibraryAgent 挑出的真实游戏截图）——那是完整的游戏界面截图，
 * 适合当翻牌配对里"随便一张有辨识度的图"，但套不进这里"单个独立图标/单张背景图"这类有具体要求的槽位，
 * 试过一次真的把截图硬塞进棋子槽位，画面里出现了缩得很小的完整界面截图，和其余棋子风格完全不搭。
 */
async function acquireCustomGameAssets(
  bridgeCutId: number,
  episodeId: number,
  spec: GameSpec,
  referenceImages: Extract<import("@/utils/ai").ReferenceList, { type: "image" }>[] = [],
): Promise<string[]> {
  const relDir = `bridgeCut/${bridgeCutId}/playable`;
  const assetUrls: string[] = [];

  for (const need of spec.assetsNeeded) {
    for (let i = 0; i < need.count; i++) {
      const relPath = `${relDir}/game/assets/custom_${assetUrls.length}.png`;
      const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
        { prompt: need.description, size: "1K", aspectRatio: "1:1", referenceList: referenceImages.length > 0 ? referenceImages : undefined },
        { taskClass: "playable-customGameAsset", describe: `Cut ${bridgeCutId} 自定义素材 ${assetUrls.length}`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      await image.save(relPath);
      assetUrls.push(await u.oss.getFileUrl(relPath));
    }
  }
  return assetUrls;
}

type CodegenOutcome = { ok: true; gameHtml: string } | { ok: false; lastError: string };

/** 代码生成 + 冒烟测试 + 失败重试的共用循环——首次生成和 revise 都走这里，区别只在传入的 spec 是新的还是调整后的 */
async function generateAndVerifyGameCode(spec: GameSpec, assetUrls: string[], codegenSystemPrompt: string): Promise<CodegenOutcome> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_CODEGEN_ATTEMPTS; attempt++) {
    let gameHtml: string;
    try {
      const result = await u.Ai.Text(TEXT_MODEL_KEY).invoke({
        system: codegenSystemPrompt,
        messages: buildGameCodeMessages(spec, assetUrls, lastError),
      });
      gameHtml = extractHtml(result.text);
    } catch (e) {
      lastError = u.error(e).message;
      continue;
    }

    const smokeTest = await runGameSmokeTest(gameHtml);
    if (smokeTest.ok) return { ok: true, gameHtml };
    lastError = smokeTest.error;
  }
  return { ok: false, lastError: lastError ?? "未知错误" };
}

/**
 * 用户描述想要的玩法（可长可短）→ LLM 整理成结构化 GameSpec → LLM 按 GameSpec 生成游戏代码 → 无头浏览器冒烟测试，
 * 不通过就把报错喂回去重试，重试耗尽就回退现有的翻牌配对路径（assemblePlayable），保证总有产物可交付。
 * 这条路径和默认的 assemble()/assemblePlayable()/revisePlayable() 完全独立，不影响它们的行为。
 */
export async function generateCustomGame(bridgeCutId: number, description: string, selectedCandidateFrames: string[] = []): Promise<CustomGameResult> {
  if (!acquireCutLock(bridgeCutId)) throw cutBusyError(bridgeCutId);
  try {
    const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
    if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
    if (cut.type !== "playableGame") throw new Error(`Cut ${bridgeCutId} 类型是 ${cut.type}，不是 playableGame`);
    if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
    const creativePlanId = cut.creativePlanId;

    const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(creativePlanId);
    const specSystemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_custom_gamespec.md"), "utf-8");
    const codegenSystemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_custom_codegen.md"), "utf-8");

    let spec: GameSpec;
    try {
      const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
        {
          schema: gameSpecSchema,
          system: specSystemPrompt,
          messages: buildGameSpecMessages(episodeAnalysis, ad, narrative, tone, description),
        },
        { taskClass: "playable-customGameSpec", describe: `Cut ${bridgeCutId} 自定义玩法规格`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      spec = object;
    } catch (e) {
      const fallback = await assemblePlayableInner(bridgeCutId, selectedCandidateFrames);
      return {
        bridgeCutId,
        previewUrl: fallback.previewUrl,
        fallback: true,
        fallbackReason: `玩法规格生成失败：${u.error(e).message}`,
        evaluatorScore: fallback.evaluation.overallScore,
        evaluatorFeedback: fallback.evaluation.feedback,
      };
    }

    const referenceImages = [...resolveCandidateReferenceImages(episodeId, selectedCandidateFrames), ...(await resolveVideoCutReferenceImages(creativePlanId))];
    const assetUrls = await acquireCustomGameAssets(bridgeCutId, episodeId, spec, referenceImages);
    const codegenResult = await generateAndVerifyGameCode(spec, assetUrls, codegenSystemPrompt);

    if (codegenResult.ok) {
      const previewUrl = await finalizePlayablePackage(bridgeCutId, creativePlanId, codegenResult.gameHtml, spec.title, spec.ctaUrl, JSON.stringify(spec), TEXT_MODEL_KEY);
      return {
        bridgeCutId,
        previewUrl,
        fallback: false,
        spec,
        evaluatorScore: 100,
        evaluatorFeedback: "自定义生成通过了自动化冒烟测试（页面正常加载、无报错），这不是内容/玩法质量评分，实际体验是否符合预期需要打开预览确认。",
      };
    }

    const fallback = await assemblePlayableInner(bridgeCutId, selectedCandidateFrames);
    return {
      bridgeCutId,
      previewUrl: fallback.previewUrl,
      fallback: true,
      fallbackReason: `自定义生成尝试 ${MAX_CODEGEN_ATTEMPTS} 次后仍未通过冒烟测试：${codegenResult.lastError}`,
      spec,
      evaluatorScore: fallback.evaluation.overallScore,
      evaluatorFeedback: fallback.evaluation.feedback,
    };
  } finally {
    releaseCutLock(bridgeCutId);
  }
}

export interface CustomGameReviseResult {
  bridgeCutId: number;
  success: boolean;
  previewUrl?: string;
  reviseFailedReason?: string; // 不成功时说明原因；此时旧游戏保持不变，没有任何东西被替换
  spec?: GameSpec;
  evaluatorScore?: number;
  evaluatorFeedback?: string;
}

/**
 * 针对已经生成的自定义游戏提修改意见——不同于 generateCustomGame 首次生成失败要回退翻牌配对（保证有产物交付），
 * 这里失败的兜底是"什么都不做，保留用户已有的、能跑的游戏"，不能用一个通用的翻牌配对顶掉用户本来满意、只是想小改的游戏。
 */
export async function reviseCustomGame(bridgeCutId: number, feedback: string): Promise<CustomGameReviseResult> {
  if (!acquireCutLock(bridgeCutId)) throw cutBusyError(bridgeCutId);
  try {
    const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
    if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
    if (cut.type !== "playableGame") throw new Error(`Cut ${bridgeCutId} 类型是 ${cut.type}，不是 playableGame`);
    if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
    if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 还没有生成过，不能 revise`);

    let existing: GameSpec;
    try {
      const parsed = JSON.parse(cut.scriptText);
      if (typeof parsed.gameType !== "string") throw new Error("不是自定义生成的游戏");
      existing = parsed as GameSpec;
    } catch {
      throw new Error(`Cut ${bridgeCutId} 当前不是自定义生成的游戏（可能是默认翻牌配对），不能用这个 revise，改用 run_sub_agent_playable_revise`);
    }

    const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
    const specSystemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_custom_gamespec.md"), "utf-8");
    const codegenSystemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "playable_custom_codegen.md"), "utf-8");

    let spec: GameSpec;
    try {
      const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
        {
          schema: gameSpecSchema,
          system: specSystemPrompt,
          messages: buildGameSpecReviseMessages(episodeAnalysis, ad, narrative, tone, existing, feedback),
        },
        { taskClass: "playable-customGameSpecRevise", describe: `Cut ${bridgeCutId} 自定义玩法规格 revise`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      spec = object;
    } catch (e) {
      return { bridgeCutId, success: false, reviseFailedReason: `规格调整失败：${u.error(e).message}，原来的游戏保持不变` };
    }

    const referenceImages = await resolveVideoCutReferenceImages(cut.creativePlanId);
    const assetUrls = await acquireCustomGameAssets(bridgeCutId, episodeId, spec, referenceImages);
    const codegenResult = await generateAndVerifyGameCode(spec, assetUrls, codegenSystemPrompt);
    if (!codegenResult.ok) {
      return { bridgeCutId, success: false, reviseFailedReason: `调整后的游戏未通过冒烟测试：${codegenResult.lastError}，原来的游戏保持不变`, spec };
    }

    const previewUrl = await finalizePlayablePackage(bridgeCutId, cut.creativePlanId, codegenResult.gameHtml, spec.title, spec.ctaUrl, JSON.stringify(spec), TEXT_MODEL_KEY);
    await recordRevise("customGame", bridgeCutId, feedback, existing, spec);
    return {
      bridgeCutId,
      success: true,
      previewUrl,
      spec,
      evaluatorScore: 100,
      evaluatorFeedback: "自定义生成通过了自动化冒烟测试（页面正常加载、无报错），这不是内容/玩法质量评分，实际体验是否符合预期需要打开预览确认。",
    };
  } finally {
    releaseCutLock(bridgeCutId);
  }
}
