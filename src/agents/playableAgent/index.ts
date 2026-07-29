import fs from "fs";
import path from "path";
import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { playableConfigSchema, type PlayableConfig } from "./schema";
import { buildGenerateMessages, buildReviseMessages } from "./prompt";
import { evaluatePlayable, type PlayableEvaluation } from "./evaluator";

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

async function assemble(bridgeCutId: number, episodeId: number, creativePlanId: number, config: PlayableConfig, evaluation: PlayableEvaluation): Promise<string> {
  const relDir = `bridgeCut/${bridgeCutId}/playable`;
  const containerTemplate = fs.readFileSync(u.getPath(["templates", "playable", "container.html"]), "utf-8");
  const gameTemplate = fs.readFileSync(u.getPath(["templates", "playable", "game.html"]), "utf-8");

  // 配对素材：LLM 给的 distinct prompt 各生成一张图，循环填满 DEFAULT_PAIRS 个格子（和 Python 参考实现的 cycle 逻辑一致）
  const tileUrls: string[] = [];
  for (let i = 0; i < config.tilePrompts.length; i++) {
    const relPath = `${relDir}/game/assets/tiles/tile_src_${i}.png`;
    const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
      { prompt: config.tilePrompts[i], size: "1K", aspectRatio: "1:1" },
      { taskClass: "playable-tileImage", describe: `Cut ${bridgeCutId} 配对素材图 ${i}`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    await image.save(relPath);
    tileUrls.push(await u.oss.getFileUrl(relPath));
  }
  const manifestTiles = Array.from({ length: DEFAULT_PAIRS }, (_, i) => tileUrls[i % tileUrls.length]);

  const gameHtml = inject(gameTemplate, { title: config.title, tiles: manifestTiles, sounds: {} });
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
    title: config.title,
    cta_url: config.ctaUrl,
    app_icon: null,
    external_game: false,
    has_video: hasVideo,
    fallback_cta_after_s: 30,
  });
  await u.oss.writeFile(`${relDir}/index.html`, Buffer.from(containerHtml, "utf-8"));

  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ scriptText: JSON.stringify(config), status: "generating" });
  await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").update({ isSelected: 0 });
  await u.db("ab_generatedSegment").insert({
    bridgeCutId,
    model: IMAGE_MODEL_KEY,
    filePath: relDir,
    state: "done",
    stage: "finalRender",
    isSelected: 1,
    createTime: Date.now(),
  });
  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "done" });

  return u.oss.getFileUrl(`${relDir}/index.html`);
}

export async function assemblePlayable(bridgeCutId: number): Promise<PlayableResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);

  try {
    const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
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
    const previewUrl = await assemble(bridgeCutId, episodeId, cut.creativePlanId, config, evaluation);
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
    const { episodeId, episodeAnalysis, ad, narrative, tone } = await loadPlanContext(cut.creativePlanId);
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
    const previewUrl = await assemble(bridgeCutId, episodeId, cut.creativePlanId, config, evaluation);
    return { bridgeCutId, config, previewUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}
