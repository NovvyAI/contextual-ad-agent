<script setup lang="ts">
// "匹配创作会话"详情页——左边剧情分析、右边营销素材分析结果，纯并排展示，不涉及聊天/生成创意方案。
// 复用现成的 EpisodeAnalysisPanel.vue（会话页面用的同一个组件，这里传 defaultExpanded 直接展开）
// 和新抽出来的 AdAnalysisPanel.vue，不用另外实现一遍两边的展示逻辑。
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import http from "@/utils/http";
import EpisodeAnalysisPanel from "@/components/session/EpisodeAnalysisPanel.vue";
import AdAnalysisPanel, { type AdAnalysisResult } from "@/components/ad/AdAnalysisPanel.vue";
import type { EpisodeAnalysis } from "@/stores/sessionAgent";

const route = useRoute();
const router = useRouter();
const matchSessionId = computed(() => Number(route.params.id));

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
      </template>
    </t-loading>
  </div>
</template>
