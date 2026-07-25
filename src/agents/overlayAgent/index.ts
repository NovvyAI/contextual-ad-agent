import u from "@/utils";
import { loadPlanContext } from "@/agents/shared/planContext";
import { overlayConfigSchema, overlayEvaluationSchema, type OverlayConfig, type OverlayEvaluation } from "./schema";
import { SYSTEM_PROMPT, buildGenerateMessages, buildReviseMessages, buildEvaluationMessages } from "./prompt";

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";
const IMAGE_MODEL_KEY = "openai:gpt-image-1";

export interface OverlayResult {
  bridgeCutId: number;
  config: OverlayConfig;
  imageUrl: string;
  evaluation: OverlayEvaluation;
}

async function evaluate(bridgeCutId: number, episodeId: number, config: OverlayConfig): Promise<OverlayEvaluation> {
  const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
    {
      schema: overlayEvaluationSchema,
      system: SYSTEM_PROMPT,
      messages: buildEvaluationMessages(config),
    },
    { taskClass: "overlay-evaluate", describe: `Cut ${bridgeCutId} CTA 卡片评估`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );
  return object;
}

async function renderAndPersist(bridgeCutId: number, episodeId: number, config: OverlayConfig, evaluation: OverlayEvaluation): Promise<string> {
  const relPath = `bridgeCut/${bridgeCutId}/overlay-${Date.now()}.png`;
  const image = await u.Ai.Image(IMAGE_MODEL_KEY).run(
    {
      prompt: config.productImagePrompt,
      size: "1K",
      aspectRatio: "1:1",
    },
    { taskClass: "overlay-productImage", describe: `Cut ${bridgeCutId} CTA 卡片产品图`, relatedObjects: String(bridgeCutId), projectId: episodeId },
  );
  await image.save(relPath);
  const imageUrl = await u.oss.getFileUrl(relPath);

  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ scriptText: JSON.stringify(config), status: "generating" });
  await u.db("ab_generatedSegment").where("bridgeCutId", bridgeCutId).where("stage", "finalRender").update({ isSelected: 0 });
  await u.db("ab_generatedSegment").insert({
    bridgeCutId,
    model: IMAGE_MODEL_KEY,
    filePath: relPath,
    state: "done",
    stage: "finalRender",
    isSelected: 1,
    createTime: Date.now(),
  });
  await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "done" });
  return imageUrl;
}

export async function generateOverlay(bridgeCutId: number): Promise<OverlayResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);

  try {
    const { episodeId, episodeAnalysis, ad } = await loadPlanContext(cut.creativePlanId);
    const { object: config } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: overlayConfigSchema,
        system: SYSTEM_PROMPT,
        messages: buildGenerateMessages(episodeAnalysis, ad),
      },
      { taskClass: "overlay-generateText", describe: `Cut ${bridgeCutId} CTA 卡片配置`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const evaluation = await evaluate(bridgeCutId, episodeId, config);
    const imageUrl = await renderAndPersist(bridgeCutId, episodeId, config, evaluation);
    return { bridgeCutId, config, imageUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}

export async function reviseOverlay(bridgeCutId: number, feedback: string): Promise<OverlayResult> {
  const cut = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
  if (!cut) throw new Error(`Cut ${bridgeCutId} 不存在`);
  if (cut.creativePlanId == null) throw new Error(`Cut ${bridgeCutId} 缺少 creativePlanId`);
  if (!cut.scriptText) throw new Error(`Cut ${bridgeCutId} 还没有生成过，不能 revise`);

  try {
    const { episodeId, episodeAnalysis, ad } = await loadPlanContext(cut.creativePlanId);
    const existing = JSON.parse(cut.scriptText) as OverlayConfig;
    const { object: config } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject(
      {
        schema: overlayConfigSchema,
        system: SYSTEM_PROMPT,
        messages: buildReviseMessages(episodeAnalysis, ad, existing, feedback),
      },
      { taskClass: "overlay-reviseText", describe: `Cut ${bridgeCutId} CTA 卡片配置 revise`, relatedObjects: String(bridgeCutId), projectId: episodeId },
    );
    const evaluation = await evaluate(bridgeCutId, episodeId, config);
    const imageUrl = await renderAndPersist(bridgeCutId, episodeId, config, evaluation);
    return { bridgeCutId, config, imageUrl, evaluation };
  } catch (e) {
    await u.db("ab_bridgeCut").where("id", bridgeCutId).update({ status: "failed" });
    throw e;
  }
}
