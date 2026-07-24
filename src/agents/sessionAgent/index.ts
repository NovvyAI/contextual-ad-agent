import { Socket } from "socket.io";
import { tool, jsonSchema } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";
import u from "@/utils";
import ResTool from "@/socket/resTool";
import { revisePlan } from "@/agents/directorAgent";

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

  return { run_sub_agent_director_plan_revise };
}

async function buildPlansContext(episodeId: number): Promise<string> {
  const plans = await u.db("ab_creativePlan").where("episodeId", episodeId).orderBy("id");
  if (plans.length === 0) return "## 当前创意方案\n（暂无）";
  const lines = plans.map((p: any) => `- id=${p.id} adId=${p.adId} status=${p.status} 基调=${p.tone}`);
  return `## 当前创意方案\n${lines.join("\n")}`;
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
