import { Socket } from "socket.io";
import { tool, jsonSchema } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";
import u from "@/utils";
import ResTool from "@/socket/resTool";
import { revisePlan } from "@/agents/directorAgent";
import { reviseDraftCut } from "@/agents/bridgeVideoAgent";
import { revisePlayable } from "@/agents/playableAgent";
import { reviseOverlay } from "@/agents/overlayAgent";

const MODEL_KEY = "anthropic:claude-opus-4-8";

export interface AgentContext {
  socket: Socket;
  episodeId: number;
  text: string;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
}

const reviseInputSchema = z.object({
  planId: z.number().describe("要修改的创意方案 id"),
  feedback: z.string().describe("用户对这份方案提出的具体修改意见"),
});

const reviseCutInputSchema = z.object({
  bridgeCutId: z.number().describe("要修改的内容 cut id"),
  feedback: z.string().describe("用户对这份内容提出的具体修改意见"),
});

function createTools(ctx: AgentContext) {
  const run_sub_agent_director_plan_revise = tool({
    description: "根据用户的自由文字反馈修改某一份已存在的创意方案，仅在用户明确针对某个具体方案提出修改意见时调用",
    inputSchema: jsonSchema<{ planId: number; feedback: string }>(reviseInputSchema.toJSONSchema()),
    execute: async ({ planId, feedback }) => {
      const updated = await revisePlan(planId, feedback);
      const planMsg = ctx.resTool.newMessage("assistant", "创意总监");
      planMsg.planCandidate({
        id: updated.id,
        adId: updated.adId,
        formatSequence: updated.formatSequence,
        narrative: updated.narrative,
        tone: updated.tone,
        planEvaluatorScore: updated.planEvaluatorScore,
        status: updated.status,
        evaluatorFeedback: updated.evaluatorFeedback,
      });
      planMsg.complete();
      return `已根据反馈修改方案 ${planId}，新的方案已推送给用户查看。`;
    },
  });

  const run_sub_agent_bridge_video_revise = tool({
    description: "只重画桥接视频的某一张分镜草案图，其他分镜草案不受影响，仅在用户针对某个具体分镜草案提出修改意见时调用",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) => {
      const updated = await reviseDraftCut(bridgeCutId, feedback);
      const cutRow = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
      const cutMsg = ctx.resTool.newMessage("assistant", "桥接视频");
      cutMsg.storyboardCut({
        bridgeCutId: updated.bridgeCutId,
        index: cutRow?.index ?? 0,
        imageUrl: updated.imageUrl,
        prompt: updated.draft.prompt,
        status: "draft",
        evaluatorScore: updated.evaluation.overallScore,
        evaluatorFeedback: updated.evaluation.feedback,
      });
      cutMsg.complete();
      return `已重画分镜草案 ${bridgeCutId}，新的草案图已推送给用户查看。`;
    },
  });

  const run_sub_agent_playable_revise = tool({
    description: "根据用户反馈重新生成互动小游戏内容，仅在用户针对某个具体游戏 cut 提出修改意见时调用",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) => {
      const updated = await revisePlayable(bridgeCutId, feedback);
      const gameMsg = ctx.resTool.newMessage("assistant", "互动游戏");
      gameMsg.contentCandidate({
        bridgeCutId: updated.bridgeCutId,
        type: "playableGame",
        previewUrl: updated.previewUrl,
        evaluatorScore: updated.evaluation.overallScore,
        evaluatorFeedback: updated.evaluation.feedback,
      });
      gameMsg.complete();
      return `已根据反馈重新生成互动游戏内容 ${bridgeCutId}，新的预览已推送给用户查看。`;
    },
  });

  const run_sub_agent_overlay_revise = tool({
    description: "根据用户反馈重新生成 CTA 卡片，仅在用户针对某个具体 CTA 卡片 cut 提出修改意见时调用",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) => {
      const updated = await reviseOverlay(bridgeCutId, feedback);
      const cardMsg = ctx.resTool.newMessage("assistant", "CTA 卡片");
      cardMsg.contentCandidate({
        bridgeCutId: updated.bridgeCutId,
        type: "ctaCard",
        previewUrl: updated.imageUrl,
        ctaUrl: updated.config.ctaUrl,
        evaluatorScore: updated.evaluation.overallScore,
        evaluatorFeedback: updated.evaluation.feedback,
      });
      cardMsg.complete();
      return `已根据反馈重新生成 CTA 卡片 ${bridgeCutId}，新的预览已推送给用户查看。`;
    },
  });

  return {
    run_sub_agent_director_plan_revise,
    run_sub_agent_bridge_video_revise,
    run_sub_agent_playable_revise,
    run_sub_agent_overlay_revise,
  };
}

async function buildPlansContext(episodeId: number): Promise<string> {
  const plans = await u.db("ab_creativePlan").where("episodeId", episodeId).orderBy("id");
  const planLines = plans.length
    ? plans.map((p: any) => `- 方案 id=${p.id} adId=${p.adId} status=${p.status} 基调=${p.tone}`)
    : ["（暂无）"];

  const planIds = plans.map((p: any) => p.id);
  const cuts = planIds.length ? await u.db("ab_bridgeCut").whereIn("creativePlanId", planIds).orderBy("id") : [];
  const cutLines = cuts.length
    ? cuts.map((c: any) => `- 内容 cut id=${c.id} 所属方案=${c.creativePlanId} 类型=${c.type} status=${c.status}`)
    : ["（暂无）"];

  return `## 当前创意方案\n${planLines.join("\n")}\n\n## 当前内容 cut\n${cutLines.join("\n")}`;
}

export async function runDecisionAI(ctx: AgentContext): Promise<void> {
  const skillPath = path.join(u.getPath("skills"), "session_agent_decision.md");
  const systemPrompt = await fs.promises.readFile(skillPath, "utf-8");
  const plansContext = await buildPlansContext(ctx.episodeId);

  const { fullStream } = await u.Ai.Text(MODEL_KEY).stream({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "assistant", content: plansContext },
      { role: "user", content: ctx.text },
    ],
    abortSignal: ctx.abortSignal,
    tools: createTools(ctx),
  });

  const text = ctx.msg.text();
  try {
    for await (const chunk of fullStream) {
      if (chunk.type === "text-delta") text.append(chunk.text);
      else if (chunk.type === "error") throw chunk.error;
    }
    text.complete();
    ctx.msg.complete();
  } catch (err) {
    text.error();
    ctx.msg.error(u.error(err).message);
    throw err;
  }
}
