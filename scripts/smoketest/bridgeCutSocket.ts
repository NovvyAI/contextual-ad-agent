import axios from "axios";
import { io } from "socket.io-client";
import u from "@/utils";

const BASE_URL = "http://localhost:10588";
const TIMEOUT_MS = 300_000; // 这条链路会真实跑 OpenAI 图片 + Seedance 视频，给足时间

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

(async () => {
  console.log("登录获取 token...");
  const loginRes = await axios.post(`${BASE_URL}/api/login/login`, { username: "admin", password: "admin123" });
  const token: string = loginRes.data.data.token;

  // 新建一个 episode（克隆已分析好的 episode 1），直接插入一份已批准的方案，跳过 M2 的方案评审环节
  const source = await u.db("ab_episode").where("id", 1).first();
  if (!source || source.status !== "analyzed") throw new Error("episode id=1 不是 analyzed 状态");
  const [episodeId] = await u.db("ab_episode").insert({
    title: "bridgeCutSocket-smoketest",
    sourceFilePath: source.sourceFilePath,
    durationMs: source.durationMs,
    status: "analyzed",
    episodeAnalysis: source.episodeAnalysis,
    workflowStage: "content_review",
    createTime: Date.now(),
  });
  const [planId] = await u.db("ab_creativePlan").insert({
    episodeId,
    adId: 1,
    formatSequence: JSON.stringify(["video", "ctaCard"]),
    narrative: "smoketest 占位方案",
    tone: "neutral",
    planEvaluatorScore: 80,
    status: "approved",
    createTime: Date.now(),
  });
  console.log("created episodeId:", episodeId, "planId:", planId);

  const socket = io(`${BASE_URL}/api/socket/sessionAgent`, { auth: { token, episodeId }, transports: ["websocket"] });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
  });
  console.log("socket 已连接:", socket.id);

  const storyboardCuts: any[] = [];
  const contentCandidates: any[] = [];
  socket.on("content:add", (payload: any) => {
    if (payload?.content?.type === "storyboardCut") storyboardCuts.push(payload.content.data);
    if (payload?.content?.type === "contentCandidate") contentCandidates.push(payload.content.data);
  });

  console.log("\n发送 bridgeCut:generate ...");
  socket.emit("bridgeCut:generate", { creativePlanId: planId });
  await waitFor(socket, "content:add", () => storyboardCuts.length >= 1, "storyboardCut");
  await waitFor(socket, "content:add", () => contentCandidates.length >= 1, "contentCandidate(ctaCard)");
  console.log(
    "收到:",
    storyboardCuts.map((c) => ({ bridgeCutId: c.bridgeCutId, status: c.status })),
    contentCandidates.map((c) => ({ bridgeCutId: c.bridgeCutId, type: c.type })),
  );

  const videoCutId = storyboardCuts[0].bridgeCutId;
  console.log(`\n发送 chat，针对分镜草案 id=${videoCutId} 提出修改意见...`);
  socket.emit("chat", { content: `请把分镜草案 id=${videoCutId} 重画一下，画面再明亮一点` });
  await waitFor(socket, "content:add", (p) => p?.content?.type === "storyboardCut" && storyboardCuts.length >= 2, "revise 后的 storyboardCut");
  console.log("revise 后收到新的 storyboardCut，共", storyboardCuts.length, "张");

  console.log(`\n发送 bridgeCut:confirm，planId=${planId}...`);
  const videoCandidates: any[] = [];
  socket.on("content:add", (payload: any) => {
    if (payload?.content?.type === "videoCandidate") videoCandidates.push(payload.content.data);
  });
  socket.emit("bridgeCut:confirm", { creativePlanId: planId });
  await waitFor(socket, "content:add", () => videoCandidates.length >= 1, "videoCandidate（Stage B 成片）");
  console.log("收到成片:", videoCandidates.map((c) => ({ bridgeCutId: c.bridgeCutId, durationMs: c.durationMs })));

  await new Promise((r) => setTimeout(r, 500));
  const videoCutRow = await u.db("ab_bridgeCut").where("id", videoCutId).first();
  if (videoCutRow?.status !== "done") throw new Error(`预期 video cut 最终状态 done，实际 ${videoCutRow?.status}`);

  socket.disconnect();
  console.log("\n✅ bridgeCutSocket smoketest 通过");
  process.exit(0);
})().catch((err) => {
  console.error("❌ bridgeCutSocket smoketest 失败:", err);
  process.exit(1);
});
