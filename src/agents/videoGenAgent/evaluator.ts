import fs from "fs";
import path from "path";
import u from "@/utils";
import { bridgeVideoEvaluationSchema, type BridgeVideoEvaluation, type StageADraft } from "./schema";

const TEXT_MODEL_KEY = "anthropic:claude-opus-4-8";

function formatDraft(draft: StageADraft): string {
  return `景别：${draft.shotSize}\n运镜：${draft.cameraMovement}\n主体动作/过渡呈现：${draft.subjectAction}\n光影氛围：${draft.lightingMood}\n情绪基调：${draft.emotionalTone}\n构图说明：${draft.framingNotes}`;
}

export async function evaluateDraft(draft: StageADraft): Promise<BridgeVideoEvaluation> {
  const text = `## 待评估分镜草案\n${formatDraft(draft)}\n\n这是 Stage A 的静态草案图（还没有渲染成视频），请据此打分，音频连续性维度给中性偏高分即可。`;
  const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "video_gen_evaluator.md"), "utf-8");
  const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject({
    schema: bridgeVideoEvaluationSchema,
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
  });
  return object;
}

export async function evaluateRender(draft: StageADraft, durationMs: number): Promise<BridgeVideoEvaluation> {
  const text = `## 待评估成片\n基于分镜草案渲染：\n${formatDraft(draft)}\n时长：${(durationMs / 1000).toFixed(1)}秒\n\n请评估这段渲染成片。`;
  const systemPrompt = await fs.promises.readFile(path.join(u.getPath("skills"), "video_gen_evaluator.md"), "utf-8");
  const { object } = await u.Ai.Text(TEXT_MODEL_KEY).invokeObject({
    schema: bridgeVideoEvaluationSchema,
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
  });
  return object;
}
