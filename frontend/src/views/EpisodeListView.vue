<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";

interface EpisodeRow {
  id: number;
  title: string;
  status: string;
  durationMs: number | null;
  createTime: number;
}

const router = useRouter();
const episodes = ref<EpisodeRow[]>([]);
const loading = ref(false);
const creating = ref(false);
const newTitle = ref("");
const newSourceFilePath = ref("data/test-assets/sample-episode.mp4");

async function loadEpisodes() {
  loading.value = true;
  try {
    const res = (await http.post("/api/episode/getEpisodeList")) as any;
    episodes.value = res.data;
  } finally {
    loading.value = false;
  }
}

async function handleCreate() {
  if (!newTitle.value || !newSourceFilePath.value) return;
  creating.value = true;
  try {
    await http.post("/api/episode/createEpisode", { title: newTitle.value, sourceFilePath: newSourceFilePath.value });
    newTitle.value = "";
    MessagePlugin.success("Episode 创建成功");
    await loadEpisodes();
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "创建失败");
  } finally {
    creating.value = false;
  }
}

async function handleAnalyze(episodeId: number) {
  await http.post("/api/episode/analyzeEpisode", { episodeId });
  MessagePlugin.info("已开始分析，请稍后刷新查看状态");
}

const statusTheme: Record<string, "default" | "success" | "danger" | "warning"> = {
  uploaded: "default",
  analyzing: "warning",
  analyzed: "success",
  failed: "danger",
};

onMounted(loadEpisodes);
</script>

<template>
  <div style="padding: 24px; max-width: 960px; margin: 0 auto">
    <t-card title="新建 Episode" style="margin-bottom: 24px">
      <t-space>
        <t-input v-model="newTitle" placeholder="标题" />
        <t-input v-model="newSourceFilePath" placeholder="服务器本地文件路径" style="width: 320px" />
        <t-button theme="primary" :loading="creating" @click="handleCreate">创建</t-button>
      </t-space>
    </t-card>

    <t-table :data="episodes" :loading="loading" row-key="id" :columns="[
      { colKey: 'id', title: 'ID', width: 60 },
      { colKey: 'title', title: '标题' },
      { colKey: 'status', title: '状态' },
      { colKey: 'op', title: '操作', width: 220 },
    ]">
      <template #status="{ row }">
        <t-tag :theme="statusTheme[row.status] ?? 'default'" variant="light">{{ row.status }}</t-tag>
      </template>
      <template #op="{ row }">
        <t-space>
          <t-button v-if="row.status === 'uploaded'" size="small" @click="handleAnalyze(row.id)">开始分析</t-button>
          <t-button v-if="row.status === 'analyzed'" size="small" theme="primary" @click="router.push(`/episodes/${row.id}`)">进入会话</t-button>
        </t-space>
      </template>
    </t-table>
  </div>
</template>
