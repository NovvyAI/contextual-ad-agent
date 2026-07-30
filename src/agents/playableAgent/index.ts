import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { playableConfigSchema, type PlayableConfig } from "./schema";
import { buildGenerateMessages, buildReviseMessages } from "./prompt";
import { evaluatePlayable, type PlayableEvaluation } from "./evaluator";
import { recordRevise } from "@/agents/shared/reviseHistory";
import { gameSpecSchema, type GameSpec } from "./customGameSchema";
import { buildGameSpecMessages, buildGameCodeMessages } from "./customGamePrompt";
import { runGameSmokeTest } from "@/utils/gameSmokeTest";

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";
const IMAGE_MODEL_KEY = "openai:gpt-image-1";
const DEFAULT_PAIRS = 8; // 照搬 Python 参考实现 build_playable.py 的 DEFAULT_PAIRS

const INJECT_RE = /\/\*INJECT\*\/\{\}\/\*END\*\//;

function inject(templateHtml: string, obj: unknown): string {
  if (!INJECT_RE.test(templateHtml)) throw new Error("模板里没有找到 /*INJECT*/{}/*END*/ 标记");
  return templateHtml.replace(INJECT_RE, JSON.stringify(obj));
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
        { prompt: config.tilePrompts[i], size: "1K", aspectRatio: "1:1" },
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

export async function assemblePlayable(bridgeCutId: number): Promise<PlayableResult> {
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
    const previewUrl = await assemble(bridgeCutId, episodeId, cut.creativePlanId, adId, ad.tileCandidates ?? [], config, evaluation);
    return { bridgeCutId, config, previewUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

export async function revisePlayable(bridgeCutId: number, feedback: string): Promise<PlayableResult> {
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
 * 按 GameSpec 需要的素材数量，用 gpt-image-1 按每一条具体描述单独生成。
 * 不复用 tileCandidates（AdLibraryAgent 挑出的真实游戏截图）——那是完整的游戏界面截图，
 * 适合当翻牌配对里"随便一张有辨识度的图"，但套不进这里"单个独立图标/单张背景图"这类有具体要求的槽位，
 * 试过一次真的把截图硬塞进棋子槽位，画面里出现了缩得很小的完整界面截图，和其余棋子风格完全不搭。
 */
async function acquireCustomGameAssets(bridgeCutId: number, episodeId: number, spec: GameSpec): Promise<string[]> {
  const relDir = `bridgeCut/${bridgeCutId}/playable`;
  const assetUrls: string[] = [];

  for (const need of spec.assetsNeeded) {
    for (let i = 0; i < need.count; i++) {
      const relPath = `${relDir}/game/assets/custom_${assetUrls.length}.png`;
      const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
        { prompt: need.description, size: "1K", aspectRatio: "1:1" },
        { taskClass: "playable-customGameAsset", describe: `Cut ${bridgeCutId} 自定义素材 ${assetUrls.length}`, relatedObjects: String(bridgeCutId), projectId: episodeId },
      );
      await image.save(relPath);
      assetUrls.push(await u.oss.getFileUrl(relPath));
    }
  }
  return assetUrls;
}

/**
 * 用户描述想要的玩法（可长可短）→ LLM 整理成结构化 GameSpec → LLM 按 GameSpec 生成游戏代码 → 无头浏览器冒烟测试，
 * 不通过就把报错喂回去重试，重试耗尽就回退现有的翻牌配对路径（assemblePlayable），保证总有产物可交付。
 * 这条路径和默认的 assemble()/assemblePlayable()/revisePlayable() 完全独立，不影响它们的行为。
 */
export async function generateCustomGame(bridgeCutId: number, description: string): Promise<CustomGameResult> {
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
    const fallback = await assemblePlayable(bridgeCutId);
    return {
      bridgeCutId,
      previewUrl: fallback.previewUrl,
      fallback: true,
      fallbackReason: `玩法规格生成失败：${u.error(e).message}`,
      evaluatorScore: fallback.evaluation.overallScore,
      evaluatorFeedback: fallback.evaluation.feedback,
    };
  }

  const assetUrls = await acquireCustomGameAssets(bridgeCutId, episodeId, spec);

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
    if (smokeTest.ok) {
      const previewUrl = await finalizePlayablePackage(bridgeCutId, creativePlanId, gameHtml, spec.title, spec.ctaUrl, JSON.stringify(spec), TEXT_MODEL_KEY);
      return {
        bridgeCutId,
        previewUrl,
        fallback: false,
        spec,
        evaluatorScore: 100,
        evaluatorFeedback: "自定义生成通过了自动化冒烟测试（页面正常加载、无报错），这不是内容/玩法质量评分，实际体验是否符合预期需要打开预览确认。",
      };
    }
    lastError = smokeTest.error;
  }

  const fallback = await assemblePlayable(bridgeCutId);
  return {
    bridgeCutId,
    previewUrl: fallback.previewUrl,
    fallback: true,
    fallbackReason: `自定义生成尝试 ${MAX_CODEGEN_ATTEMPTS} 次后仍未通过冒烟测试：${lastError}`,
    spec,
    evaluatorScore: fallback.evaluation.overallScore,
    evaluatorFeedback: fallback.evaluation.feedback,
  };
}
