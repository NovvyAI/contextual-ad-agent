<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";
import LocalFilePicker from "@/components/common/LocalFilePicker.vue";

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
  if (!newTitle.value.trim() && !newSourceFilePath.value.trim()) {
    MessagePlugin.warning("请填写标题和服务器本地文件路径");
    return;
  }
  if (!newTitle.value.trim()) {
    MessagePlugin.warning("请填写标题");
    return;
  }
  if (!newSourceFilePath.value.trim()) {
    MessagePlugin.warning("请填写服务器本地文件路径");
    return;
  }
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

let pollTimer: ReturnType<typeof setInterval> | null = null;

function pollUntilSettled() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    await loadEpisodes();
    if (!episodes.value.some((e) => e.status === "analyzing")) {
      clearInterval(pollTimer!);
      pollTimer = null;
    }
  }, 3000);
}

async function handleAnalyze(episodeId: number) {
  await http.post("/api/episode/analyzeEpisode", { episodeId });
  MessagePlugin.info("已开始分析，完成后会自动刷新状态");
  await loadEpisodes();
  pollUntilSettled();
}

async function handleDelete(episodeId: number) {
  try {
    await http.post("/api/episode/deleteEpisode", { episodeId });
    MessagePlugin.success("已删除");
    await loadEpisodes();
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "删除失败");
  }
}

const statusTheme: Record<string, "default" | "success" | "danger" | "warning"> = {
  uploaded: "default",
  analyzing: "warning",
  analyzed: "success",
  failed: "danger",
};

onMounted(async () => {
  await loadEpisodes();
  if (episodes.value.some((e) => e.status === "analyzing")) pollUntilSettled();
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div style="padding: 24px; max-width: 960px; margin: 0 auto">
    <t-card title="新建 Episode" style="margin-bottom: 24px">
      <t-space align="end">
        <div>
          <div style="font-size: 12px; color: var(--td-text-color-secondary, #666); margin-bottom: 4px">
            标题<span style="color: var(--td-error-color, #d54941)">*</span>
          </div>
          <t-input v-model="newTitle" placeholder="标题" />
        </div>
        <div>
          <div style="font-size: 12px; color: var(--td-text-color-secondary, #666); margin-bottom: 4px">
            服务器本地文件路径<span style="color: var(--td-error-color, #d54941)">*</span>
          </div>
          <t-space>
            <t-input v-model="newSourceFilePath" placeholder="服务器本地文件路径" style="width: 320px" />
            <LocalFilePicker @uploaded="(p) => (newSourceFilePath = p)" />
          </t-space>
        </div>
        <t-button theme="primary" :loading="creating" @click="handleCreate">创建</t-button>
      </t-space>
    </t-card>

    <t-table :data="episodes" :loading="loading" row-key="id" :columns="[
      { colKey: 'id', title: 'ID', width: 60 },
      { colKey: 'title', title: '标题' },
      { colKey: 'status', title: '状态' },
      { colKey: 'op', title: '操作', width: 280 },
    ]">
      <template #status="{ row }">
        <t-tag :theme="statusTheme[row.status] ?? 'default'" variant="light">{{ row.status }}</t-tag>
      </template>
      <template #op="{ row }">
        <t-space>
          <t-button v-if="row.status === 'uploaded'" size="small" @click="handleAnalyze(row.id)">开始分析</t-button>
          <t-button v-if="row.status === 'failed'" size="small" theme="warning" @click="handleAnalyze(row.id)">重新分析</t-button>
          <t-button v-if="row.status === 'analyzed'" size="small" theme="primary" @click="router.push(`/episodes/${row.id}`)">进入会话</t-button>
          <t-popconfirm content="确定删除这个 Episode 吗？关联的创意方案/内容也会一起删除" theme="danger" @confirm="handleDelete(row.id)">
            <t-button size="small" theme="danger" variant="outline">删除</t-button>
          </t-popconfirm>
        </t-space>
      </template>
    </t-table>
  </div>
</template>
