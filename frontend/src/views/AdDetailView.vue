<script setup lang="ts">
// 营销素材分析结果详情页——从 AdListView.vue 点"查看分析结果"跳转过来，不再是悬浮弹窗。
// 复用 getAdListAll 现成接口（返回里已经带 analysisResult），不用再新开一个按 id 查询的后端接口。
// 具体的分栏展示逻辑在 AdAnalysisPanel.vue（"匹配创作会话"详情页也要用同一份展示，抽出来两处复用）。
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import http from "@/utils/http";
import AdAnalysisPanel, { type AdAnalysisResult } from "@/components/ad/AdAnalysisPanel.vue";

const route = useRoute();
const router = useRouter();
const adId = computed(() => Number(route.params.id));

interface AdRow {
  id: number;
  name: string;
  brandName: string | null;
  status: string;
  analysisResult: string | null;
}

const loading = ref(true);
const ad = ref<AdRow | null>(null);
const analysis = ref<AdAnalysisResult | null>(null);
const parseError = ref(false);

// watch 而不是 onMounted：从一条素材的详情页直接跳到另一条（route 只有 :id 参数变了，
// 组件实例被 vue-router 复用、不会重新 mount）也要重新拉数据，不然会一直显示上一条素材的内容
watch(
  adId,
  async (id) => {
    loading.value = true;
    ad.value = null;
    analysis.value = null;
    parseError.value = false;
    try {
      const res = (await http.post("/api/ad/getAdListAll")) as any;
      const row = (res.data as AdRow[]).find((r) => r.id === id) ?? null;
      ad.value = row;
      if (row?.analysisResult) {
        try {
          analysis.value = JSON.parse(row.analysisResult);
        } catch {
          parseError.value = true;
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
  <div style="padding: 24px; max-width: 900px; margin: 0 auto">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px">
      <t-button variant="text" @click="router.push('/ads')">← 返回营销素材列表</t-button>
    </div>

    <t-loading :loading="loading">
      <template v-if="!ad">
        <p style="color: var(--td-text-color-placeholder, #999)">没有找到这条营销素材。</p>
      </template>
      <template v-else>
        <h2 style="margin: 0 0 4px">{{ ad.name }}</h2>
        <p v-if="ad.brandName" style="margin: 0 0 20px; color: var(--td-text-color-secondary, #666)">品牌：{{ ad.brandName }}</p>

        <p v-if="parseError" style="color: var(--td-error-color, #d54941)">分析结果解析失败，数据格式异常。</p>
        <p v-else-if="!analysis" style="color: var(--td-text-color-placeholder, #999)">还没有分析结果。</p>
        <AdAnalysisPanel v-else :analysis="analysis" />
      </template>
    </t-loading>
  </div>
</template>
