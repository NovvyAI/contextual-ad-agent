import { Socket } from "socket.io";
import { tool, jsonSchema } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";
import u from "@/utils";
import ResTool from "@/socket/resTool";
import { revisePlan } from "@/agents/directorAgent";
import { reviseDraftCut, reviseStageBMotion } from "@/agents/videoGenAgent";
import { revisePlayable, reviseCustomGame } from "@/agents/playableAgent";
import * as actions from "@/agents/sessionAgent/actions";

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

const planIdInputSchema = z.object({
  planId: z.number().describe("要确认/批准的创意方案 id"),
});

const creativePlanIdInputSchema = z.object({
  creativePlanId: z.number().describe("要操作的创意方案 id"),
});

/**
 * revise 类工具的失败统一在这里兜底——这几个工具的 execute() 直接调用耗时的生成/revise 函数，
 * 原来没有任何 try/catch：一旦背后的模型调用抛错（最常见的是供应商侧临时超时/不可用），
 * 这个异常会在 AI SDK 的工具执行链路里被吞掉，聊天框里不会有任何反馈——用户体感就是"发了消息但完全没反应"，
 * 而不是一条看得懂的失败提示。这里统一兜底：先给用户推一张明确的错误卡片（不依赖模型后续会不会再开口说话），
 * 再把失败原因如实当工具结果返回给模型，模型如果还有后续步骤可以据此再用文字跟用户解释。
 *
 * 同时在这里统一推一条"正在处理"的即时确认消息——聊天触发的 revise 走到这里之前，模型的文字回复
 * 可能什么都还没说就直接调用了工具，fn() 本身又是真实的模型调用（图片/视频生成常常要几十秒到几分钟），
 * 这段时间之前完全没有任何反馈，用户体感和点完按钮后台没反应一样。和 actions.ts 里按钮触发流程的
 * "已确认，正在生成...请稍候" 是同一个思路，这里统一给所有走 safeRevise 的聊天工具补上。
 */
async function safeRevise(ctx: AgentContext, label: string, fn: () => Promise<string>): Promise<string> {
  const ackMsg = ctx.resTool.newMessage("assistant");
  const ackText = ackMsg.text(`已收到，正在${label}，请稍候...`);
  ackText.complete();
  ackMsg.complete();
  try {
    return await fn();
  } catch (e) {
    const message = u.error(e).message;
    console.error(`[sessionAgent] ${label}失败:`, message);
    const errMsg = ctx.resTool.newMessage("assistant");
    errMsg.error(`${label}失败：${message}`);
    return `${label}失败：${message}。已经把失败原因推送给用户看到了，不需要再用文字重复解释一遍。`;
  }
}

function createTools(ctx: AgentContext) {
  const run_sub_agent_director_plan_revise = tool({
    description: "根据用户的自由文字反馈修改某一份已存在的创意方案，仅在用户明确针对某个具体方案提出修改意见时调用",
    inputSchema: jsonSchema<{ planId: number; feedback: string }>(reviseInputSchema.toJSONSchema()),
    execute: async ({ planId, feedback }) =>
      safeRevise(ctx, "方案调整", async () => {
        const updated = await revisePlan(planId, feedback);
        const planMsg = ctx.resTool.newMessage("assistant", "创意总监");
        planMsg.planCandidate({
          id: updated.id,
          adId: updated.adId,
          narrative: updated.narrative,
          tone: updated.tone,
          planEvaluatorScore: updated.planEvaluatorScore,
          status: updated.status,
          evaluatorFeedback: updated.evaluatorFeedback,
        });
        planMsg.complete();
        return `已根据反馈修改方案 ${planId}，评分 ${updated.planEvaluatorScore}，评审意见：${updated.evaluatorFeedback.feedback}。新的方案已推送给用户查看。`;
      }),
  });

  const run_sub_agent_bridge_video_revise = tool({
    description:
      "重新生成桥接视频的分镜草案图（画面内容会改变），仅在用户反馈涉及画面内容本身时调用" +
      "（比如「头发乱了」「场景不对」「人物表情不对」这类画面构图/主体/光影问题）。" +
      "如果反馈只是关于运镜或节奏（比如「运镜太快」「镜头晃得奇怪」），且该 cut 已经渲染出成片，" +
      "应该改用 run_sub_agent_bridge_video_revise_motion，不要用这个工具，因为这个工具会让用户重新走一遍确认分镜、渲染成片的流程。" +
      "如果反馈本身模糊、看不出是画面内容问题还是运镜/节奏问题，不要自己猜，直接用文字询问用户「是画面内容需要重新设计，还是只是运镜/节奏需要调整」。",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) =>
      safeRevise(ctx, "分镜草案重新生成", async () => {
        const updated = await reviseDraftCut(bridgeCutId, feedback);
        const cutRow = await u.db("ab_bridgeCut").where("id", bridgeCutId).first();
        const cutMsg = ctx.resTool.newMessage("assistant", "桥接视频");
        cutMsg.storyboardCut({
          bridgeCutId: updated.bridgeCutId,
          index: cutRow?.index ?? 0,
          imageUrl: updated.imageUrl,
          prompt: updated.assembledPrompt,
          status: "draft",
          evaluatorScore: updated.evaluation.overallScore,
          evaluatorFeedback: updated.evaluation.feedback,
        });
        cutMsg.complete();
        return `已重新生成分镜草案 ${bridgeCutId}，评分 ${updated.evaluation.overallScore}，评审意见：${updated.evaluation.feedback}。新的草案图已推送给用户查看，需要用户重新确认分镜、渲染成片。`;
      }),
  });

  const run_sub_agent_bridge_video_revise_motion = tool({
    description:
      "只调整桥接视频成片的运镜/节奏/时长，草案图不会重新生成、画面内容不变，仅在该 cut 已经渲染出成片（status=done）" +
      "且用户反馈明确是关于运镜/动态节奏/时长问题时调用（比如「运镜太快了」「镜头晃得有点奇怪」「节奏拖沓」「太短了，再长一点」）。" +
      "如果反馈是关于画面内容本身（人物/场景/构图看起来不对），应该调用 run_sub_agent_bridge_video_revise 重新生成草案，不要用这个工具。" +
      "如果反馈本身模糊、看不出是哪一种，不要自己猜，直接用文字询问用户「是画面内容需要重新设计，还是只是运镜/节奏需要调整」。",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) =>
      safeRevise(ctx, "运镜/节奏调整", async () => {
        const updated = await reviseStageBMotion(bridgeCutId, feedback);
        const msg = ctx.resTool.newMessage("assistant", "桥接视频");
        msg.videoCandidate({
          bridgeCutId: updated.bridgeCutId,
          videoUrl: updated.videoUrl,
          durationMs: updated.durationMs,
          evaluatorScore: updated.evaluation.overallScore,
          evaluatorFeedback: updated.evaluation.feedback,
        });
        msg.complete();
        return `已调整成片 ${bridgeCutId} 的运镜/节奏并重新渲染，草案图和画面内容未改变，评分 ${updated.evaluation.overallScore}，评审意见：${updated.evaluation.feedback}。新的成片已推送给用户查看。`;
      }),
  });

  const run_sub_agent_playable_revise = tool({
    description:
      "根据用户反馈重新生成互动小游戏内容，仅在这个 cut 是默认的翻牌配对（不是自定义生成的游戏）时调用。" +
      "如果这个 cut 是走「自定义玩法生成」产出的自定义游戏，应该改用 run_sub_agent_custom_game_revise，不要用这个工具。" +
      "如果不确定这个 cut 是哪种，直接调用即可——函数自己会校验，不是自定义游戏的话不会报错。",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) =>
      safeRevise(ctx, "互动游戏重新生成", async () => {
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
        return `已根据反馈重新生成互动游戏内容 ${bridgeCutId}，评分 ${updated.evaluation.overallScore}，评审意见：${updated.evaluation.feedback}。新的预览已推送给用户查看。`;
      }),
  });

  const run_sub_agent_custom_game_revise = tool({
    description:
      "根据用户反馈调整一个已经用「自定义玩法生成」产出的游戏，仅在这个 cut 是自定义生成的游戏时调用" +
      "（比如「太难了，调整通关条件」「这个玩法节奏太慢」「换个视觉风格」）。" +
      "如果这个 cut 是默认的翻牌配对，应该改用 run_sub_agent_playable_revise，不要用这个工具。" +
      "这次调整如果失败（比如自动化验证没通过），原来能玩的游戏会保持不变，不会被替换成默认版本。",
    inputSchema: jsonSchema<{ bridgeCutId: number; feedback: string }>(reviseCutInputSchema.toJSONSchema()),
    execute: async ({ bridgeCutId, feedback }) =>
      safeRevise(ctx, "自定义游戏调整", async () => {
        const result = await reviseCustomGame(bridgeCutId, feedback);
        if (!result.success) {
          const errMsg = ctx.resTool.newMessage("assistant");
          errMsg.error(`自定义游戏调整未成功：${result.reviseFailedReason}`);
          return `自定义游戏调整未成功：${result.reviseFailedReason}。已经把失败原因推送给用户看到了，不需要再用文字重复解释一遍。`;
        }
        const gameMsg = ctx.resTool.newMessage("assistant", "互动游戏");
        gameMsg.contentCandidate({
          bridgeCutId: result.bridgeCutId,
          type: "playableGame",
          previewUrl: result.previewUrl!,
          evaluatorScore: result.evaluatorScore!,
          evaluatorFeedback: result.evaluatorFeedback,
          custom: true,
        });
        gameMsg.complete();
        return `已根据反馈调整自定义游戏 ${bridgeCutId}。新的预览已推送给用户查看。`;
      }),
  });

  const run_confirm_plan = tool({
    description:
      "确认/批准某一份创意方案，仅在用户明确表达要选定某个具体方案时调用（比如「我选方案1」「就用第二个」「确认这个方案」）。" +
      "背后是和按钮点击完全一样的确定性逻辑，会自动校验当前阶段是否允许。",
    inputSchema: jsonSchema<{ planId: number }>(planIdInputSchema.toJSONSchema()),
    execute: async ({ planId }) => {
      await actions.confirmPlanAction(ctx.resTool, ctx.episodeId, planId);
      return `已提交对方案 ${planId} 的确认请求，处理结果请看下方消息。`;
    },
  });

  const run_generate_content = tool({
    description: "为已确认（approved）的方案生成桥接内容，仅在用户明确要求开始生成内容/分镜草案时调用（比如「开始生成内容」「生成吧」）",
    inputSchema: jsonSchema<{ creativePlanId: number }>(creativePlanIdInputSchema.toJSONSchema()),
    execute: async ({ creativePlanId }) => {
      await actions.generateContentAction(ctx.resTool, ctx.episodeId, creativePlanId);
      return `已为方案 ${creativePlanId} 提交生成内容的请求，处理结果请看下方消息。`;
    },
  });

  const run_confirm_draft_cuts = tool({
    description: "确认分镜草案、开始渲染成片，仅在用户明确表示分镜草案没问题可以渲染成片时调用（比如「草案可以，渲染成片吧」「确认分镜」）",
    inputSchema: jsonSchema<{ creativePlanId: number }>(creativePlanIdInputSchema.toJSONSchema()),
    execute: async ({ creativePlanId }) => {
      await actions.confirmDraftCutsAction(ctx.resTool, creativePlanId);
      return `已为方案 ${creativePlanId} 提交确认分镜草案的请求，处理结果请看下方消息。`;
    },
  });

  const run_assemble_playable = tool({
    description:
      "视频成片渲染完成后，确认组装小游戏，仅在用户明确要求继续组装小游戏时调用（比如「组装小游戏」「继续吧」，通常发生在刚看到成片之后）",
    inputSchema: jsonSchema<{ creativePlanId: number }>(creativePlanIdInputSchema.toJSONSchema()),
    execute: async ({ creativePlanId }) => {
      await actions.assemblePlayableAction(ctx.resTool, creativePlanId);
      return `已为方案 ${creativePlanId} 提交组装小游戏的请求，处理结果请看下方消息。`;
    },
  });

  const run_confirm_content = tool({
    description: "确认内容完成、进入终审与落地，仅在用户明确表示内容没问题可以进入终审时调用（比如「可以了，提交终审」「确认内容」）",
    inputSchema: jsonSchema<{ creativePlanId: number }>(creativePlanIdInputSchema.toJSONSchema()),
    execute: async ({ creativePlanId }) => {
      await actions.confirmContentAction(ctx.resTool, ctx.episodeId, creativePlanId);
      return `已为方案 ${creativePlanId} 提交进入终审与落地的请求，处理结果请看下方消息。`;
    },
  });

  return {
    run_sub_agent_director_plan_revise,
    run_sub_agent_bridge_video_revise,
    run_sub_agent_bridge_video_revise_motion,
    run_sub_agent_playable_revise,
    run_sub_agent_custom_game_revise,
    run_confirm_plan,
    run_generate_content,
    run_confirm_draft_cuts,
    run_assemble_playable,
    run_confirm_content,
  };
}

async function buildPlansContext(episodeId: number): Promise<string> {
  const episode = await u.db("ab_episode").where("id", episodeId).first();
  const plans = await u.db("ab_creativePlan").where("episodeId", episodeId).orderBy("id");
  const planLines = plans.length
    ? plans.map((p: any) => `- 方案 id=${p.id} adId=${p.adId} status=${p.status} 基调=${p.tone}`)
    : ["（暂无）"];

  const planIds = plans.map((p: any) => p.id);
  const cuts = planIds.length ? await u.db("ab_bridgeCut").whereIn("creativePlanId", planIds).orderBy("id") : [];
  const cutLines = cuts.length
    ? cuts.map((c: any) => {
        let variant = "";
        if (c.type === "playableGame" && c.scriptText) {
          try {
            variant = JSON.parse(c.scriptText).gameType ? "（自定义生成）" : "（默认翻牌配对）";
          } catch {
            // scriptText 解析失败就不标注，不影响其余信息展示
          }
        }
        return `- 内容 cut id=${c.id} 所属方案=${c.creativePlanId} 类型=${c.type}${variant} status=${c.status}`;
      })
    : ["（暂无）"];

  return `## 当前阶段\nworkflowStage=${episode?.workflowStage ?? "未知"}\n\n## 当前创意方案\n${planLines.join("\n")}\n\n## 当前内容 cut\n${cutLines.join("\n")}`;
}

export async function runDecisionAI(ctx: AgentContext): Promise<void> {
  const skillPath = path.join(u.getPath("skills"), "session_agent_decision.md");
  const skillPrompt = await fs.promises.readFile(skillPath, "utf-8");
  const plansContext = await buildPlansContext(ctx.episodeId);
  // 当前运行时状态不伪装成 assistant 说过的话——那个角色语义上代表"模型之前的输出"，
  // 硬塞运行时状态进去容易让模型把它当成自己的既有结论，调试时也分不清是真实对话还是系统注入。
  // 挪进 system 里，和用户消息严格分开，语义清楚：这是框架每次现查现拼给模型看的当前状态，不是对话历史。
  const systemPrompt = `${skillPrompt}\n\n${plansContext}`;

  const { fullStream } = await u.Ai.Text(MODEL_KEY).stream({
    system: systemPrompt,
    messages: [{ role: "user", content: ctx.text }],
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
