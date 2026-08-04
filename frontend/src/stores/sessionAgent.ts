// Session（=Episode）维度的 store 工厂，每个 episodeId 一个独立 store 实例（Map 缓存），
// 照抄 Toonflow-web 的 store-per-session 模式（src/stores/scriptAgent.ts）。
import { ref } from "vue";
import { defineStore } from "pinia";
import http from "@/utils/http";
import { useChat } from "@/composables/useChat";

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
}

function makeSessionAgentStore(episodeId: number) {
  return defineStore(`sessionAgent-${episodeId}`, () => {
    const sessionState = ref<SessionState | null>(null);
    const loadingSessionState = ref(false);

    const chat = useChat({
      url: "/api/socket/sessionAgent",
      auth: () => ({ episodeId }),
      manageLifecycle: false,
      autoConnect: false,
    });

    async function loadSessionState() {
      loadingSessionState.value = true;
      try {
        const res = (await http.post("/api/episode/getSessionState", { episodeId })) as any;
        sessionState.value = res.data;
        // 只在聊天面板还是空的时候回放历史——loadSessionState 之后还会在别的时机被重新调用
        // （比如每次助手消息生成完），那些时候 messages 已经有实时消息了，不能再回放一遍历史，
        // 否则会把已经在看的实时消息前面重复插入一遍
        if (chat.messages.value.length === 0 && res.data.chatEvents?.length) {
          chat.hydrateHistory(res.data.chatEvents);
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
      generatePlan,
      approvePlan,
      generateBridgeCuts,
      confirmBridgeCuts,
      assemblePlayableCut,
      generateCustomGame,
      confirmContent,
      retryBridgeCut,
    };
  });
}

const storeMap = new Map<number, ReturnType<typeof makeSessionAgentStore>>();

export default function useSessionAgentStore(episodeId: number) {
  if (!storeMap.has(episodeId)) storeMap.set(episodeId, makeSessionAgentStore(episodeId));
  return storeMap.get(episodeId)!();
}
