<script setup lang="ts">
// 独立监控页面（data/monitor/index.html）的 SPA 版本——同一份数据源和 socket 协议，搬进主应用当一个
// 和 Episodes/创意素材平级的 tab，不用再单独开一个 http://localhost:10588/monitor/ 页签、也不用手动
// 同步 localStorage token（http.ts 的拦截器已经处理了）。data/monitor/index.html 本身保留不删——
// 它是给不经过 Vite 的部署场景（纯后端跑起来就能看）用的独立入口，两边各自维护，逻辑是同一套后端接口。
import { ref, computed, onMounted, onUnmounted } from "vue";
import { io, Socket } from "socket.io-client";
import http from "@/utils/http";

type StageStatus = "pending" | "in_progress" | "done" | "failed";
interface StageProgress {
  key: string;
  label: string;
  status: StageStatus;
}
interface SessionProgress {
  episodeId: number;
  stages: StageProgress[];
}
interface SessionRow {
  episodeId: number;
  title: string;
  progress: SessionProgress;
  lastActivity: string | null;
}
interface TaskRow {
  id: number;
  taskClass: string;
  model: string;
  stage: string;
  describe: string;
  state: "running" | "done" | "failed";
  durationMs?: number;
}

const sessions = ref<Map<number, SessionRow>>(new Map());
const sortedSessions = computed(() => [...sessions.value.values()].sort((a, b) => b.episodeId - a.episodeId));
const loading = ref(false);
const connected = ref(false);
let socket: Socket | null = null;

const detailVisible = ref(false);
const detailEpisodeId = ref<number | null>(null);
const detailTitle = ref("");
const detailTasks = ref<TaskRow[]>([]);
const detailLoading = ref(false);
const reversedDetailTasks = computed(() => [...detailTasks.value].reverse());

function currentStage(progress: SessionProgress): StageProgress {
  const idx = progress.stages.findIndex((s) => s.status !== "done");
  return idx === -1 ? progress.stages[progress.stages.length - 1] : progress.stages[idx];
}
function stageBadgeLabel(status: StageStatus): string {
  return status === "done" ? "已完成" : status === "in_progress" ? "进行中" : status === "failed" ? "失败" : "未开始";
}
function stageBadgeTheme(status: StageStatus): "success" | "warning" | "danger" | "default" {
  return status === "done" ? "success" : status === "in_progress" ? "warning" : status === "failed" ? "danger" : "default";
}
function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function loadSessions() {
  loading.value = true;
  try {
    const res = (await http.post("/api/monitor/getSessions")) as any;
    const map = new Map<number, SessionRow>();
    for (const s of res.data ?? []) map.set(s.episodeId, { episodeId: s.episodeId, title: s.title, progress: s.progress, lastActivity: null });
    sessions.value = map;
  } finally {
    loading.value = false;
  }
}

async function refreshSessionProgress(episodeId: number) {
  try {
    const res = (await http.post("/api/episode/getSessionProgress", { episodeId })) as any;
    const s = sessions.value.get(episodeId);
    if (s) s.progress = res.data;
  } catch {
    // 进度刷新失败不影响主流程，下次事件来了会再试
  }
}

async function openDetail(episodeId: number) {
  detailEpisodeId.value = episodeId;
  const s = sessions.value.get(episodeId);
  detailTitle.value = `#${episodeId} ${s?.title ?? ""} · 调用时间线`;
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    const res = (await http.post("/api/monitor/getSessionTasks", { episodeId })) as any;
    detailTasks.value = (res.data ?? []).map((r: any) => ({
      id: r.id,
      taskClass: r.taskClass,
      model: r.model,
      stage: r.stage,
      describe: r.describe,
      state: r.state === "已完成" ? "done" : r.state === "生成失败" ? "failed" : "running",
      durationMs: r.durationMs,
    }));
  } finally {
    detailLoading.value = false;
  }
}

function connectSocket() {
  socket = io("/api/socket/monitor", { transports: ["websocket", "polling"] });
  socket.on("connect", () => (connected.value = true));
  socket.on("disconnect", () => (connected.value = false));

  socket.on("task:start", (e: any) => {
    const s = sessions.value.get(e.projectId);
    if (s) s.lastActivity = `进行中：${e.describe}`;
    if (detailEpisodeId.value === e.projectId) {
      detailTasks.value.push({ id: e.id, taskClass: e.taskClass, model: e.model, stage: e.stage, describe: e.describe, state: "running" });
    }
  });
  socket.on("task:done", (e: any) => {
    const s = sessions.value.get(e.projectId);
    if (s) s.lastActivity = `${e.state === 1 ? "完成" : "失败"}：${e.taskClass}（${formatDuration(e.durationMs)}）`;
    if (detailEpisodeId.value === e.projectId) {
      const t = detailTasks.value.find((t) => t.id === e.id);
      if (t) {
        t.state = e.state === 1 ? "done" : "failed";
        t.durationMs = e.durationMs;
      }
    }
    // task:done 意味着这个 episode 的阶段可能推进了，重新拉一次它的 progress
    if (e.projectId) refreshSessionProgress(e.projectId);
  });
}

onMounted(async () => {
  await loadSessions();
  connectSocket();
});
onUnmounted(() => {
  socket?.disconnect();
  socket = null;
});
</script>

<template>
  <div style="padding: 24px; max-width: 1200px; margin: 0 auto">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h3 style="margin: 0">会话监控 · 全部 Session 实时进度</h3>
      <t-tag :theme="connected ? 'success' : 'warning'" variant="light">{{ connected ? "已连接（实时）" : "未连接" }}</t-tag>
    </div>

    <t-table
      :data="sortedSessions"
      :loading="loading"
      row-key="episodeId"
      hover
      :columns="[
        { colKey: 'episode', title: 'Episode' },
        { colKey: 'stages', title: '8 阶段' },
        { colKey: 'curStep', title: '当前步骤' },
        { colKey: 'lastActivity', title: '最近活动' },
      ]"
      @row-click="(ctx) => openDetail((ctx.row as SessionRow).episodeId)"
    >
      <template #episode="{ row }">#{{ row.episodeId }} {{ row.title }}</template>
      <template #stages="{ row }">
        <div class="stage-dots">
          <span
            v-for="s in row.progress.stages"
            :key="s.key"
            class="dot"
            :class="s.status"
            :title="`${s.label}: ${stageBadgeLabel(s.status)}`"
          ></span>
        </div>
      </template>
      <template #curStep="{ row }">
        {{ currentStage(row.progress).label }}
        <t-tag size="small" :theme="stageBadgeTheme(currentStage(row.progress).status)" variant="light" style="margin-left: 6px">
          {{ stageBadgeLabel(currentStage(row.progress).status) }}
        </t-tag>
      </template>
      <template #lastActivity="{ row }">{{ row.lastActivity || "—" }}</template>
    </t-table>

    <t-dialog v-model:visible="detailVisible" :header="detailTitle" width="760px" :footer="false">
      <t-loading :loading="detailLoading" size="small">
        <div v-if="detailTasks.length === 0" class="empty">这个 episode 还没有调用记录</div>
        <div v-for="t in reversedDetailTasks" :key="t.id" class="task-row" :class="t.state">
          <span class="tclass">{{ t.taskClass }}</span>
          <span class="model">{{ t.model }}</span>
          <t-tag size="small" variant="light" style="flex: none">{{ t.stage }}</t-tag>
          <span class="desc">{{ t.describe }}</span>
          <span class="dur">{{ t.state === "running" ? "进行中" : formatDuration(t.durationMs) }}</span>
        </div>
      </t-loading>
    </t-dialog>
  </div>
</template>

<style scoped>
.stage-dots {
  display: flex;
  gap: 3px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--td-bg-color-component, #e7e7e7);
  flex: none;
}
.dot.done {
  background: var(--td-success-color, #2ba471);
}
.dot.in_progress {
  background: var(--td-warning-color, #e37318);
  animation: pulse 1.2s infinite;
}
.dot.failed {
  background: var(--td-error-color, #d54941);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.empty {
  color: var(--td-text-color-placeholder, #999);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.task-row {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--td-border-level-1-color, #f0f0f0);
  font-size: 12.5px;
}
.task-row:last-child {
  border-bottom: none;
}
.task-row .tclass {
  font-family: monospace;
  color: var(--td-brand-color, #0052d9);
  flex: none;
  width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-row .model {
  font-family: monospace;
  color: var(--td-warning-color, #e37318);
  flex: none;
  width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-row .desc {
  flex: 1;
  color: var(--td-text-color-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-row .dur {
  font-family: monospace;
  flex: none;
  width: 60px;
  text-align: right;
  color: var(--td-text-color-secondary, #666);
}
.task-row.done .dur {
  color: var(--td-success-color, #2ba471);
}
.task-row.failed .dur {
  color: var(--td-error-color, #d54941);
}
.task-row.running .dur {
  color: var(--td-warning-color, #e37318);
}
</style>
