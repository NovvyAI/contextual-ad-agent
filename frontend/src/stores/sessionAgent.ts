// Session 维度的 store 工厂，每个 session 一个独立 store 实例（Map 缓存），
// 照抄 Toonflow-web 的 store-per-session 模式（src/stores/scriptAgent.ts）。
// 两种 session：legacy 的 Episode 会话（/episodes/:id，工作流挂在 ab_episode 上）和匹配创作会话
// （/match-sessions/:id，工作流挂在 ab_matchSession 上，同一个 Episode 可以有多个并行）。
// socket 客户端实际 emit 的事件 payload 里从来不带 episodeId（episodeId 只在连接握手时传一次），
// 所以两种模式的差异只在：连接 auth 字段、和读状态/进度/任务日志这 3 个 REST 接口的 URL+body——
// 十几个 emit 动作本身完全共用，不用按 kind 分叉实现。
import { ref, watch } from "vue";
import { defineStore } from "pinia";
import http from "@/utils/http";
import { useChat } from "@/composables/useChat";

export type SessionKey = { kind: "episode"; episodeId: number } | { kind: "matchSession"; matchSessionId: number };

function sessionKeyToken(key: SessionKey): string {
  return key.kind === "episode" ? `episode:${key.episodeId}` : `matchSession:${key.matchSessionId}`;
}

export type StageStatus = "pending" | "in_progress" | "done" | "failed";
export interface StageProgress {
  key: string;
  label: string;
  status: StageStatus;
}
export interface SessionProgress {
  episodeId: number;
  stages: StageProgress[];
}

// 和 src/utils/taskEvents.ts 的 TaskStartEvent/TaskDoneEvent 对应，前端这份只是展示用，不用完全照抄字段
export interface TaskLogEntry {
  id: number;
  taskClass: string;
  stage: string;
  describe: string;
  model: string;
  startTime: number;
  durationMs?: number;
  state: "running" | "done" | "failed";
  input?: string;
  output?: string;
}

export interface EpisodeAnalysis {
  plot: string;
  characters: { name: string; description: string; role: "protagonist" | "antagonist" | "supporting" }[];
  emotionArc: { timestampS: number; emotion: string; description?: string }[];
  keyVisuals: { timestampS: number; description: string; importance?: "high" | "medium" | "low" }[];
  endingState: {
    summary: string;
    cliffhanger: boolean;
    lastVisualDescription: string;
    suggestedTone: string;
    viewerEmotionalState: { primaryEmotion: string; intensity: "high" | "medium" | "low"; residualTension: string; transitionReadiness: string };
  };
  // 供生成游戏素材时参考选用的候选帧，老数据可能没有这个字段
  tileCandidates?: string[];
  tileCandidateImages?: { filename: string; url: string }[];
}

export interface SessionState {
  episode: {
    id: number;
    title: string;
    status: string;
    workflowStage: string;
    durationMs: number | null;
    createTime: number | null;
    episodeAnalysis: EpisodeAnalysis | null;
  };
  creativePlans: {
    id: number;
    adId: number;
    narrative: string;
    tone: string;
    planEvaluatorScore: number;
    status: "draft" | "approved" | "rejected";
  }[];
  bridgeCuts: {
    id: number;
    creativePlanId: number;
    index: number;
    type: "video" | "playableGame";
    status: string;
    durationMs: number | null;
    latestDraft: { imageUrl: string; prompt: string | null } | null;
    latestRender: { url: string; filePath: string } | null;
  }[];
  manifest: { id: number; type: string; deliverableUrl: string; ctaUrl?: string } | null;
  progress: SessionProgress;
}

function makeSessionAgentStore(key: SessionKey) {
  return defineStore(`sessionAgent-${sessionKeyToken(key)}`, () => {
    const sessionState = ref<SessionState | null>(null);
    const loadingSessionState = ref(false);
    const taskLog = ref<TaskLogEntry[]>([]);

    const chat = useChat({
      url: "/api/socket/sessionAgent",
      auth: () => (key.kind === "episode" ? { episodeId: key.episodeId } : { matchSessionId: key.matchSessionId }),
      manageLifecycle: false,
      autoConnect: false,
    });

    // task:start/task:done 是 sessionAgent.ts 按 episodeId 过滤转发的调用事件（见 src/socket/routes/sessionAgent.ts）
    // chat.socket 是个 shallowRef，connect() 之后才会真正创建 Socket 实例，所以监听器挂在
    // watch 里、socket 实例出现之后再注册，而不是在 store 初始化时就假设它已经存在
    watch(
      chat.socket,
      (socket) => {
        if (!socket) return;
        socket.on("task:start", (event: any) => {
          // loadTaskLog() 已经拉过一次历史记录，如果这条任务在拉取和 socket 连上之间的窗口期已经开始
          // （历史记录里已经有了），这里不能再无脑 push 一遍，不然时间轴会看到两条一样的记录
          if (taskLog.value.some((t) => t.id === event.id)) return;
          taskLog.value.push({
            id: event.id,
            taskClass: event.taskClass,
            stage: event.stage,
            describe: event.describe,
            model: event.model,
            startTime: event.startTime,
            state: "running",
            input: event.input,
          });
        });
        socket.on("task:done", (event: any) => {
          const entry = taskLog.value.find((t) => t.id === event.id);
          if (entry) {
            entry.durationMs = event.durationMs;
            entry.state = event.state === 1 ? "done" : "failed";
            entry.output = event.output;
          }
          // 进度可能推进了一步，只刷新这一小块，不重新拉整份 sessionState（聊天记录等不需要跟着重拉）
          refreshProgress();
        });
      },
      { immediate: true },
    );

    async function refreshProgress() {
      try {
        const res = (
          key.kind === "episode"
            ? await http.post("/api/episode/getSessionProgress", { episodeId: key.episodeId })
            : await http.post("/api/matchSession/getMatchSessionProgress", { matchSessionId: key.matchSessionId })
        ) as any;
        if (sessionState.value) sessionState.value.progress = res.data;
      } catch {
        // 进度刷新失败不影响主流程，静默跳过，下次事件来了会再试
      }
    }

    // 调用时间轴需要的是这个 episode 从头到尾的完整调用历史，不只是"打开页面之后新发生的"——
    // 复用独立监控页面已经有的 /api/monitor/getSessionTasks（按 projectId=episodeId 查 o_tasks，
    // 附带算好的 stage），不用再新开一个接口。像 storyboard-analysis 这种在打开会话页面之前
    // 就已经跑完的调用（比如在 Episode 列表页点"开始分析"触发的），不补这一步就永远不会出现在时间轴里。
    async function loadTaskLog() {
      try {
        const res = (
          key.kind === "episode"
            ? await http.post("/api/monitor/getSessionTasks", { episodeId: key.episodeId })
            : await http.post("/api/matchSession/getMatchSessionTasks", { matchSessionId: key.matchSessionId })
        ) as any;
        taskLog.value = (res.data ?? []).map((r: any) => ({
          id: r.id,
          taskClass: r.taskClass,
          stage: r.stage,
          describe: r.describe,
          model: r.model,
          startTime: r.startTime,
          durationMs: r.durationMs,
          state: r.state === "已完成" ? "done" : r.state === "生成失败" ? "failed" : "running",
          input: r.input,
          output: r.output,
        }));
      } catch {
        // 历史调用记录加载失败不影响主流程，静默跳过，之后的实时记录还是能正常显示
      }
    }

    async function loadSessionState() {
      loadingSessionState.value = true;
      try {
        if (key.kind === "episode") {
          const res = (await http.post("/api/episode/getSessionState", { episodeId: key.episodeId })) as any;
          sessionState.value = res.data;
          // 只在聊天面板还是空的时候回放历史——loadSessionState 之后还会在别的时机被重新调用
          // （比如每次助手消息生成完），那些时候 messages 已经有实时消息了，不能再回放一遍历史，
          // 否则会把已经在看的实时消息前面重复插入一遍
          if (chat.messages.value.length === 0 && res.data.chatEvents?.length) {
            chat.hydrateHistory(res.data.chatEvents);
          }
        } else {
          const res = (await http.post("/api/matchSession/getMatchSessionState", { matchSessionId: key.matchSessionId })) as any;
          const ms = res.data.matchSession;
          // 归一化成和 episode 模式一样的 SessionState 形状——ActionBar/MessageList 等共用组件只读
          // workflowStage/episodeAnalysis，title/status/durationMs/createTime 这几个匹配会话模式下用不到，填占位值
          sessionState.value = {
            episode: { id: ms.episodeId, title: "", status: "", workflowStage: ms.workflowStage, durationMs: null, createTime: null, episodeAnalysis: ms.episodeAnalysis },
            creativePlans: res.data.creativePlans,
            bridgeCuts: res.data.bridgeCuts,
            manifest: res.data.manifest,
            progress: res.data.progress,
          };
          if (chat.messages.value.length === 0 && res.data.chatEvents?.length) {
            chat.hydrateHistory(res.data.chatEvents);
          }
        }
      } finally {
        loadingSessionState.value = false;
      }
    }

    function generatePlan(adIds: number[]) {
      chat.socket.value?.emit("plan:generate", { adIds });
    }
    function approvePlan(planId: number) {
      chat.socket.value?.emit("plan:approve", { planId });
    }
    function setPlanFeedback(planId: number, feedback: "like" | "dislike" | null) {
      chat.socket.value?.emit("plan:feedback", { planId, feedback });
    }
    function generateBridgeCuts(creativePlanId: number, imageModelKey?: string, videoModelKey?: string, videoResolution?: string) {
      chat.socket.value?.emit("bridgeCut:generate", { creativePlanId, imageModelKey, videoModelKey, videoResolution });
    }
    function confirmBridgeCuts(creativePlanId: number) {
      chat.socket.value?.emit("bridgeCut:confirm", { creativePlanId });
    }
    function assemblePlayableCut(creativePlanId: number, selectedCandidateFrames: string[] = []) {
      chat.socket.value?.emit("bridgeCut:assemblePlayable", { creativePlanId, selectedCandidateFrames });
    }
    function generateCustomGame(bridgeCutId: number, description: string, selectedCandidateFrames: string[] = []) {
      chat.socket.value?.emit("bridgeCut:customGameGenerate", { bridgeCutId, description, selectedCandidateFrames });
    }
    function confirmContent(creativePlanId: number) {
      chat.socket.value?.emit("content:confirm", { creativePlanId });
    }
    function retryBridgeCut(bridgeCutId: number) {
      chat.socket.value?.emit("bridgeCut:retry", { bridgeCutId });
    }

    return {
      ...chat,
      sessionState,
      loadingSessionState,
      loadSessionState,
      taskLog,
      loadTaskLog,
      generatePlan,
      approvePlan,
      setPlanFeedback,
      generateBridgeCuts,
      confirmBridgeCuts,
      assemblePlayableCut,
      generateCustomGame,
      confirmContent,
      retryBridgeCut,
    };
  });
}

const storeMap = new Map<string, ReturnType<typeof makeSessionAgentStore>>();

export default function useSessionAgentStore(key: SessionKey) {
  const token = sessionKeyToken(key);
  if (!storeMap.has(token)) storeMap.set(token, makeSessionAgentStore(key));
  return storeMap.get(token)!();
}
