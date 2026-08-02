<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import http from "@/utils/http";
import useSessionAgentStore from "@/stores/sessionAgent";
import MessageList from "@/components/chat/MessageList.vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import ActionBar from "@/components/chat/ActionBar.vue";
import EpisodeAnalysisPanel from "@/components/session/EpisodeAnalysisPanel.vue";

const route = useRoute();
const episodeId = computed(() => Number(route.params.id));
const store = computed(() => useSessionAgentStore(episodeId.value));

const ads = ref<{ id: number; name: string; summary: string }[]>([]);

async function loadAds() {
  // getAdList 只返回已分析的广告（DirectorAgent 消费用的 ads[] 形状，id 是字符串，name 是额外补的展示字段）
  const res = (await http.post("/api/ad/getAdList")) as any;
  ads.value = res.data.map((a: any) => ({ id: Number(a.id), name: a.name ?? `广告 ${a.id}`, summary: a.summary ?? "" }));
}

// 每次助手消息生成完成（不管是确定性操作的响应，还是自由文字 revise 的响应），都重新拉一次
// sessionState——比精确区分"这是不是确定性操作的响应"更简单也更不容易漏更新
watch(
  () => store.value.status,
  (status, prevStatus) => {
    if (prevStatus !== "idle" && status === "idle") store.value.loadSessionState();
  },
);

onMounted(async () => {
  store.value.connect();
  await Promise.all([store.value.loadSessionState(), loadAds()]);
});

onUnmounted(() => {
  store.value.disconnect();
});

function handleSend(text: string) {
  store.value.chat(text);
}
</script>

<template>
  <div style="display: flex; flex-direction: column; height: calc(100vh - 57px)">
    <div style="padding: 12px 16px; border-bottom: 1px solid var(--td-border-level-2-color, #e7e7e7)">
      <b>{{ store.sessionState?.episode.title }}</b>
      <t-tag variant="light" style="margin-left: 8px">{{ store.sessionState?.episode.workflowStage }}</t-tag>
      <t-tag v-if="!store.connected" theme="warning" variant="light" style="margin-left: 8px">未连接</t-tag>
    </div>

    <EpisodeAnalysisPanel v-if="store.sessionState?.episode.episodeAnalysis" :analysis="store.sessionState.episode.episodeAnalysis" />

    <MessageList v-if="store.sessionState" :messages="store.messages" :episode-id="episodeId" />

    <ActionBar
      v-if="store.sessionState"
      :session-state="store.sessionState"
      :ads="ads"
      :busy="store.isGenerating"
      :on-generate-plan="(adIds) => store.generatePlan(adIds)"
      :on-generate-content="(planId, imageModelKey, videoModelKey) => store.generateBridgeCuts(planId, imageModelKey, videoModelKey)"
      :on-confirm-bridge-cuts="(planId) => store.confirmBridgeCuts(planId)"
      :on-assemble-playable="(planId, selectedCandidateFrames) => store.assemblePlayableCut(planId, selectedCandidateFrames)"
      :on-generate-custom-game="(cutId, description, selectedCandidateFrames) => store.generateCustomGame(cutId, description, selectedCandidateFrames)"
      :on-confirm-content="(planId) => store.confirmContent(planId)"
      :on-retry-bridge-cut="(cutId) => store.retryBridgeCut(cutId)"
    />

    <ChatInput :generating="store.isGenerating" @send="handleSend" @stop="store.stopGenerate()" />
  </div>
</template>
