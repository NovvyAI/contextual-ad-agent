<script setup lang="ts">
// "匹配创作会话"详情页——上半部分是剧情分析+营销素材分析结果并排展示（纯参考信息，不变），
// 下半部分是完整的聊天驱动生成流程（创意方案生成、分镜草案、成片渲染、小游戏组装、终审落地），
// 和 SessionView.vue（/episodes/:id）用的是同一套组件和同一个 store 工厂，只是 session key 换成
// matchSessionId——工作流状态挂在 ab_matchSession 而不是 ab_episode，所以同一个 Episode 配不同广告
// 的多个匹配会话可以各自独立并行推进，互不阻塞（这正是"匹配会话"这个概念存在的意义）。
// 广告已经在创建匹配会话时锁定，ActionBar 的 fixedAdId 会隐藏广告多选下拉框，不用再选一遍。
import { ref, computed, watch, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import http from "@/utils/http";
import EpisodeAnalysisPanel from "@/components/session/EpisodeAnalysisPanel.vue";
import AdAnalysisPanel, { type AdAnalysisResult } from "@/components/ad/AdAnalysisPanel.vue";
import useSessionAgentStore from "@/stores/sessionAgent";
import type { EpisodeAnalysis } from "@/stores/sessionAgent";
import MessageList from "@/components/chat/MessageList.vue";
import ChatInput from "@/components/chat/ChatInput.vue";
import ActionBar from "@/components/chat/ActionBar.vue";
import SessionProgressPanel from "@/components/session/SessionProgressPanel.vue";
import TaskTimelinePanel from "@/components/session/TaskTimelinePanel.vue";

const route = useRoute();
const router = useRouter();
const matchSessionId = computed(() => Number(route.params.id));
const store = computed(() => useSessionAgentStore({ kind: "matchSession", matchSessionId: matchSessionId.value }));

interface MatchSessionDetail {
  id: number;
  episodeId: number;
  episodeTitle: string;
  episodeAnalysis: EpisodeAnalysis | null;
  adId: number;
  adName: string;
  adAnalysisResult: string | null;
}

const loading = ref(true);
const detail = ref<MatchSessionDetail | null>(null);
const adAnalysis = ref<AdAnalysisResult | null>(null);
const adParseError = ref(false);

// watch 而不是 onMounted：同一个路由只是 :id 参数变化时组件实例会被复用、不会重新 mount，
// AdDetailView.vue 已经踩过这个坑，这里直接用正确写法
watch(
  matchSessionId,
  async (id) => {
    loading.value = true;
    detail.value = null;
    adAnalysis.value = null;
    adParseError.value = false;
    try {
      const res = (await http.post("/api/matchSession/getMatchSessionDetail", { matchSessionId: id })) as any;
      detail.value = res.data;
      if (res.data?.adAnalysisResult) {
        try {
          adAnalysis.value = JSON.parse(res.data.adAnalysisResult);
        } catch {
          adParseError.value = true;
        }
      }
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

// 聊天/生成区的连接单独用一个 watch——同样要处理"同路由换 :id 参数、组件实例被复用"这个坑：
// 切到另一个匹配会话时，先断开上一个 store 的连接，再连新的，不然两边 socket 会同时挂着
watch(
  matchSessionId,
  async (id, prevId) => {
    if (prevId !== undefined && prevId !== id) {
      useSessionAgentStore({ kind: "matchSession", matchSessionId: prevId }).disconnect();
    }
    // loadSessionState 内部会把持久化的聊天历史回放进 messages，loadTaskLog 拉调用时间轴的历史记录，
    // 两个都要先跑完再连 socket——不然刚连上就可能到来的实时事件会和历史回放交错，顺序就乱了
    await Promise.all([store.value.loadSessionState(), store.value.loadTaskLog()]).then(() => store.value.connect());
  },
  { immediate: true },
);

// 每次助手消息生成完成（不管是按钮触发的确定性操作响应，还是自由文字 revise 的响应），都重新拉一次
// sessionState——照抄 SessionView.vue 的同名 watcher，之前漏加导致确认方案后页面顶部 workflowStage
// 一直停留在旧值，直到手动刷新才更新（button 触发的 socket 事件和 chat() 走的是同一套 status 追踪）
watch(
  () => store.value.status,
  (status, prevStatus) => {
    if (prevStatus !== "idle" && status === "idle") store.value.loadSessionState();
  },
);

onUnmounted(() => {
  store.value.disconnect();
});

function handleSend(text: string) {
  store.value.chat(text);
}
</script>

<template>
  <div style="padding: 24px; max-width: 1200px; margin: 0 auto">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
      <t-button variant="text" @click="router.push('/match-sessions')">← 返回匹配创作会话列表</t-button>
    </div>

    <t-loading :loading="loading">
      <template v-if="!detail">
        <p style="color: var(--td-text-color-placeholder, #999)">没有找到这个匹配创作会话。</p>
      </template>
      <template v-else>
        <h2 style="margin: 0 0 16px">{{ detail.episodeTitle }} × {{ detail.adName }}</h2>

        <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap">
          <div style="flex: 1; min-width: 360px">
            <h4 style="margin: 0 0 8px">剧情分析</h4>
            <div v-if="!detail.episodeAnalysis" style="color: var(--td-text-color-placeholder, #999)">这个 Episode 还没有分析结果。</div>
            <EpisodeAnalysisPanel v-else :analysis="detail.episodeAnalysis" :default-expanded="true" />
          </div>

          <div style="flex: 1; min-width: 360px">
            <h4 style="margin: 0 0 8px">营销素材分析结果</h4>
            <p v-if="adParseError" style="color: var(--td-error-color, #d54941)">分析结果解析失败，数据格式异常。</p>
            <div v-else-if="!adAnalysis" style="color: var(--td-text-color-placeholder, #999)">这条营销素材还没有分析结果。</div>
            <AdAnalysisPanel v-else :analysis="adAnalysis" />
          </div>
        </div>

        <h4 style="margin: 24px 0 8px; padding-top: 16px; border-top: 1px solid var(--td-border-level-2-color, #e7e7e7)">创作会话</h4>
        <div style="display: flex; flex-direction: column; height: 75vh; border: 1px solid var(--td-border-level-2-color, #e7e7e7); border-radius: 6px">
          <div style="padding: 8px 16px; border-bottom: 1px solid var(--td-border-level-2-color, #e7e7e7); display: flex; align-items: center">
            <t-tag variant="light">{{ store.sessionState?.episode.workflowStage }}</t-tag>
            <t-tag v-if="!store.connected" theme="warning" variant="light" style="margin-left: 8px">未连接</t-tag>
          </div>

          <SessionProgressPanel :progress="store.sessionState?.progress ?? null" />

          <div style="display: flex; flex: 1; min-height: 0">
            <MessageList v-if="store.sessionState" :messages="store.messages" :episode-id="detail.episodeId" :match-session-id="detail.id" style="flex: 1" />
            <TaskTimelinePanel :task-log="store.taskLog" />
          </div>

          <ActionBar
            v-if="store.sessionState"
            :session-state="store.sessionState"
            :ads="[]"
            :fixed-ad-id="detail.adId"
            :busy="store.isGenerating"
            :on-generate-plan="(adIds) => store.generatePlan(adIds)"
            :on-generate-content="(planId, imageModelKey, videoModelKey, videoResolution) => store.generateBridgeCuts(planId, imageModelKey, videoModelKey, videoResolution)"
            :on-confirm-bridge-cuts="(planId) => store.confirmBridgeCuts(planId)"
            :on-assemble-playable="(planId, selectedCandidateFrames) => store.assemblePlayableCut(planId, selectedCandidateFrames)"
            :on-generate-custom-game="(cutId, description, selectedCandidateFrames) => store.generateCustomGame(cutId, description, selectedCandidateFrames)"
            :on-confirm-content="(planId) => store.confirmContent(planId)"
            :on-retry-bridge-cut="(cutId) => store.retryBridgeCut(cutId)"
          />

          <ChatInput :generating="store.isGenerating" @send="handleSend" @stop="store.stopGenerate()" />
        </div>
      </template>
    </t-loading>
  </div>
</template>
