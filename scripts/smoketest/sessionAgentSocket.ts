import axios from "axios";
import { io } from "socket.io-client";
import u from "@/utils";

const BASE_URL = "http://localhost:10588";
const TIMEOUT_MS = 120_000;

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
  if (!token) throw new Error("登录未拿到 token");

  const source = await u.db("ab_episode").where("id", 1).first();
  if (!source || source.status !== "analyzed") throw new Error("episode id=1 不是 analyzed 状态，先跑 storyboardAgent smoketest");
  const [episodeId] = await u.db("ab_episode").insert({
    title: "sessionAgentSocket-smoketest",
    sourceFilePath: source.sourceFilePath,
    durationMs: source.durationMs,
    status: "analyzed",
    episodeAnalysis: source.episodeAnalysis,
    workflowStage: "uploaded",
    createTime: Date.now(),
  });
  console.log("created episode id:", episodeId);

  const socket = io(`${BASE_URL}/api/socket/sessionAgent`, {
    auth: { token, episodeId },
    transports: ["websocket"],
  });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
  });
  console.log("socket 已连接:", socket.id);

  const planContents: any[] = [];
  socket.on("content:add", (payload: any) => {
    if (payload?.content?.type === "planCandidate") planContents.push(payload.content.data);
  });

  console.log("\n发送 plan:generate ...");
  socket.emit("plan:generate", { adIds: [1, 2] });
  await waitFor(socket, "content:add", (p) => p?.content?.type === "planCandidate", "第一份 planCandidate");
  await waitFor(socket, "content:add", (p) => p?.content?.type === "planCandidate" && planContents.length >= 2, "第二份 planCandidate");
  if (planContents.length < 2) throw new Error(`预期至少 2 份 planCandidate，实际 ${planContents.length}`);
  console.log(
    "收到的方案:",
    planContents.map((p) => ({ id: p.id, adId: p.adId, status: p.status })),
  );

  const targetPlanId = planContents[0].id;
  console.log(`\n发送 chat，针对方案 id=${targetPlanId} 提出修改意见...`);
  socket.emit("chat", { content: `请把方案 id=${targetPlanId} 的形式换成纯 CTA 卡片，语气再轻松一点` });

  const revisedEvent = await waitFor(
    socket,
    "content:add",
    (p) => p?.content?.type === "planCandidate" && p.content.data.id === targetPlanId && p.content.data !== planContents[0],
    "revise 后的 planCandidate",
  );
  const revisedData = (revisedEvent as any).content.data;
  console.log("revise 后的方案:", revisedData);
  if (revisedData.narrative === planContents[0].narrative) throw new Error("revise 后 narrative 应该有变化");

  console.log(`\n发送 plan:approve，planId=${targetPlanId}...`);
  socket.emit("plan:approve", { planId: targetPlanId });
  await waitFor(socket, "message:update", (p) => true, "plan:approve 的消息更新");

  await new Promise((r) => setTimeout(r, 500));
  const episode = await u.db("ab_episode").where("id", episodeId).first();
  if (episode?.workflowStage !== "content_review") throw new Error(`预期 content_review，实际 ${episode?.workflowStage}`);
  console.log("workflowStage:", episode.workflowStage);

  socket.disconnect();
  console.log("\n✅ sessionAgentSocket smoketest 通过");
  process.exit(0);
})().catch((err) => {
  console.error("❌ sessionAgentSocket smoketest 失败:", err);
  process.exit(1);
});
