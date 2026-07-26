import axios from "axios";
import { io } from "socket.io-client";
import u from "@/utils";

const BASE_URL = "http://localhost:10588";
// 这条链路会真实跑图片生成 + Seedance 视频 + 小游戏配对图（2-6 张图顺序生成，实测单张接近 1 分钟），
// 给足时间——实测跑完整条链路到 playableGame 组装完成接近 10 分钟，300s 曾经在这一步超时过。
const TIMEOUT_MS = 600_000;

function waitFor<T = any>(socket: ReturnType<typeof io>, event: string, predicate: (payload: any) => boolean, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待 "${label}" 超时（${TIMEOUT_MS}ms）`));
    }, TIMEOUT_MS);
    const handler = (payload: any) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/**
 * M7：三选一桥接形式改成固定"过渡视频→H5 小游戏"两段式管线之后的端到端 smoketest，
 * 取代 M2-M6 时期按"一份方案一个 cut"写的 bridgeCutSocket.ts/contentConfirmSocket.ts。
 * 覆盖完整交互流程：生成方案→确认方案→生成内容（只出草案）→确认分镜草案，渲染成片→
 * 手动确认组装小游戏→确认内容，进入终审与落地。
 */
(async () => {
  console.log("登录获取 token...");
  const loginRes = await axios.post(`${BASE_URL}/api/login/login`, { username: "admin", password: "admin123" });
  const token: string = loginRes.data.data.token;

  const source = await u.db("ab_episode").where("id", 1).first();
  if (!source || source.status !== "analyzed") throw new Error("episode id=1 不是 analyzed 状态");
  if (!source.episodeAnalysis || !JSON.parse(source.episodeAnalysis).endingState?.viewerEmotionalState) {
    throw new Error("episode id=1 的 episodeAnalysis 还没有 viewerEmotionalState，先重新跑一遍 StoryboardAgent 分析");
  }
  const [episodeId] = await u.db("ab_episode").insert({
    title: "m7BridgeFlow-smoketest",
    sourceFilePath: source.sourceFilePath,
    durationMs: source.durationMs,
    status: "analyzed",
    episodeAnalysis: source.episodeAnalysis,
    workflowStage: "uploaded",
    createTime: Date.now(),
  });
  console.log("created episodeId:", episodeId);

  const socket = io(`${BASE_URL}/api/socket/sessionAgent`, { auth: { token, episodeId }, transports: ["websocket"] });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
  });
  console.log("socket 已连接:", socket.id);

  const planCandidates: any[] = [];
  const storyboardCuts: any[] = [];
  const videoCandidates: any[] = [];
  const contentCandidates: any[] = [];
  const supervisorResults: any[] = [];
  const manifests: any[] = [];
  const errors: any[] = [];
  socket.on("content:add", (payload: any) => {
    const t = payload?.content?.type;
    if (t === "planCandidate") planCandidates.push(payload.content.data);
    if (t === "storyboardCut") storyboardCuts.push(payload.content.data);
    if (t === "videoCandidate") videoCandidates.push(payload.content.data);
    if (t === "contentCandidate") contentCandidates.push(payload.content.data);
    if (t === "supervisorResult") supervisorResults.push(payload.content.data);
    if (t === "manifest") manifests.push(payload.content.data);
  });
  socket.on("message:update", (payload: any) => {
    if (payload?.status === "error") errors.push(payload.ext?.error);
  });

  console.log("\n发送 plan:generate（adId=1）...");
  socket.emit("plan:generate", { adIds: [1] });
  await waitFor(socket, "content:add", () => planCandidates.length >= 1, "planCandidate");
  const plan = planCandidates[0];
  console.log("收到方案:", { id: plan.id, adId: plan.adId, planEvaluatorScore: plan.planEvaluatorScore });
  if ("formatSequence" in plan) throw new Error("planCandidate 不应该再带 formatSequence 字段");
  if (typeof plan.evaluatorFeedback?.gameRelevance !== "number") throw new Error("planCandidate.evaluatorFeedback 缺少 gameRelevance");

  console.log("\n发送 plan:approve...");
  socket.emit("plan:approve", { planId: plan.id });
  await new Promise((r) => setTimeout(r, 1000));

  console.log("\n发送 bridgeCut:generate...");
  socket.emit("bridgeCut:generate", { creativePlanId: plan.id });
  await waitFor(socket, "content:add", () => storyboardCuts.length >= 1, "storyboardCut（video Stage A 草案）");
  console.log("收到分镜草案:", { bridgeCutId: storyboardCuts[0].bridgeCutId, status: storyboardCuts[0].status });

  // M7 关键不变量：bridgeCut:generate 此时应该已经把两个 cut 都建好了（video+playableGame），
  // 但只应该生成了 video 段的内容——playableGame 段要等手动确认才触发
  await new Promise((r) => setTimeout(r, 500));
  const cutsAfterGenerate = await u.db("ab_bridgeCut").where("creativePlanId", plan.id);
  if (cutsAfterGenerate.length !== 2) throw new Error(`预期建了 2 个 cut，实际 ${cutsAfterGenerate.length} 个`);
  const gameCutRow = cutsAfterGenerate.find((c: any) => c.type === "playableGame");
  if (gameCutRow?.status !== "pending") throw new Error(`playableGame cut 在 bridgeCut:generate 阶段就不应该被动过，实际状态 ${gameCutRow?.status}`);
  console.log("确认：两个 cut 已建好（video+playableGame），playableGame 仍是 pending —— 符合 M7 手动确认点设计");

  const videoCutId = storyboardCuts[0].bridgeCutId;
  console.log(`\n发送 bridgeCut:confirm，planId=${plan.id}...`);
  socket.emit("bridgeCut:confirm", { creativePlanId: plan.id });
  await waitFor(socket, "content:add", () => videoCandidates.length >= 1, "videoCandidate（Stage B 成片）");
  console.log("收到成片:", { bridgeCutId: videoCandidates[0].bridgeCutId, durationMs: videoCandidates[0].durationMs });

  await new Promise((r) => setTimeout(r, 500));
  const videoCutRow = await u.db("ab_bridgeCut").where("id", videoCutId).first();
  if (videoCutRow?.status !== "done") throw new Error(`预期 video cut 状态 done，实际 ${videoCutRow?.status}`);

  console.log("\n发送 bridgeCut:assemblePlayable（M7 新增的手动确认点）...");
  socket.emit("bridgeCut:assemblePlayable", { creativePlanId: plan.id });
  await waitFor(socket, "content:add", () => contentCandidates.length >= 1, "contentCandidate（playableGame 组装完成）");
  console.log("收到小游戏:", { bridgeCutId: contentCandidates[0].bridgeCutId, type: contentCandidates[0].type });
  if (contentCandidates[0].type !== "playableGame") throw new Error(`预期 contentCandidate.type 是 playableGame，实际 ${contentCandidates[0].type}`);

  const gameCutId = contentCandidates[0].bridgeCutId;
  await new Promise((r) => setTimeout(r, 500));
  const gameCutRowAfter = await u.db("ab_bridgeCut").where("id", gameCutId).first();
  if (gameCutRowAfter?.status !== "done") throw new Error(`预期 playableGame cut 状态 done，实际 ${gameCutRowAfter?.status}`);

  // M7 关键：PlayableAgent 装配时应该读取真实的 video 段成片，而不是旧的 Episode 尾帧占位
  const gameSegment = await u.db("ab_generatedSegment").where("bridgeCutId", gameCutId).where("stage", "finalRender").where("isSelected", 1).first();
  if (!gameSegment?.filePath) throw new Error("小游戏 cut 缺少已选定的最终产物");
  const fs = await import("fs");
  const bridgeMp4Path = u.getPath(["oss", gameSegment.filePath, "bridge.mp4"]);
  if (!fs.existsSync(bridgeMp4Path)) throw new Error(`游戏包里缺少 bridge.mp4: ${bridgeMp4Path}`);
  const videoSegment = await u.db("ab_generatedSegment").where("bridgeCutId", videoCutId).where("stage", "finalRender").where("isSelected", 1).first();
  if (!videoSegment?.filePath) throw new Error("video cut 缺少已选定的最终产物");
  const originalRenderSize = fs.statSync(u.getPath(["oss", videoSegment.filePath])).size;
  const bridgeMp4Size = fs.statSync(bridgeMp4Path).size;
  if (originalRenderSize !== bridgeMp4Size) {
    throw new Error(`游戏包里的 bridge.mp4（${bridgeMp4Size} bytes）应该和 video 段真实成片（${originalRenderSize} bytes）大小一致`);
  }
  console.log("确认：游戏包里的 bridge.mp4 就是 video 段的真实成片，不是 Episode 尾帧占位");

  console.log(`\n发送 content:confirm，planId=${plan.id}...`);
  socket.emit("content:confirm", { creativePlanId: plan.id });
  await waitFor(socket, "content:add", () => supervisorResults.length >= 1, "supervisorResult");
  console.log("终审结果:", supervisorResults[0]);
  if (supervisorResults[0].bridgeCutId !== gameCutId) throw new Error(`终审应该针对 playableGame cut(${gameCutId})，实际 ${supervisorResults[0].bridgeCutId}`);

  if (supervisorResults[0].passed) {
    console.log("终审通过，验证 Assembler 编排...");
    await waitFor(socket, "content:add", () => manifests.length >= 1, "manifest");
    console.log("最终交付物:", manifests[0]);
    if (manifests[0].type !== "playableGame") throw new Error(`manifest.type 预期 playableGame，实际 ${manifests[0].type}`);

    await new Promise((r) => setTimeout(r, 500));
    const finalEpisode = await u.db("ab_episode").where("id", episodeId).first();
    if (finalEpisode?.workflowStage !== "assembling") throw new Error(`预期 assembling，实际 ${finalEpisode?.workflowStage}`);
    console.log("workflowStage:", finalEpisode.workflowStage, "; ab_manifest 已落库");
  } else {
    // 真实素材（SMPTE 测试卡）终审判不通过是诚实的拦截结果，不是 bug——见 CLAUDE.md 关于 sample-episode.mp4 的说明
    console.log("终审判定不通过（真实 LLM 对测试素材的诚实判断），验证没有误触发 Assembler...");
    const finalEpisode = await u.db("ab_episode").where("id", episodeId).first();
    if (finalEpisode?.workflowStage !== "content_review") throw new Error(`预期仍是 content_review，实际 ${finalEpisode?.workflowStage}`);
    if (manifests.length > 0) throw new Error("不通过时不应该收到 manifest 消息");
  }

  if (errors.length > 0) throw new Error(`流程中出现了未预期的 error 消息: ${JSON.stringify(errors)}`);

  socket.disconnect();
  console.log("\n✅ m7BridgeFlow smoketest 通过");
  process.exit(0);
})().catch((err) => {
  console.error("❌ m7BridgeFlow smoketest 失败:", err);
  process.exit(1);
});
