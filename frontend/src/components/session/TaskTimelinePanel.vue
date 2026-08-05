<script setup lang="ts">
// 会话页面右侧的大模型调用时间轴——从 SessionProgressPanel.vue 拆出来（那边现在只剩顶部的 8 步进度条），
// 用 TDesign 的 t-timeline 摆在聊天区右边，点开某条记录能看这次调用真实的输入/输出（数据来自
// src/utils/ai.ts 的 logModelCall 同一份 summarizeForLog 结果，二进制内容已经替换成简短描述）。
import { ref, computed } from "vue";
import type { TaskLogEntry } from "@/stores/sessionAgent";

const props = defineProps<{
  taskLog: TaskLogEntry[];
}>();

// 时间轴最新的调用排在最上面
const reversedLog = computed(() => [...props.taskLog].reverse());

const detailVisible = ref(false);
const detailEntry = ref<TaskLogEntry | null>(null);

function openDetail(entry: TaskLogEntry) {
  detailEntry.value = entry;
  detailVisible.value = true;
}

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function dotColor(state: TaskLogEntry["state"]): string {
  if (state === "done") return "var(--td-success-color, #2ba471)";
  if (state === "failed") return "var(--td-error-color, #d54941)";
  return "var(--td-warning-color, #e37318)";
}

// input/output 落库时已经是 JSON.stringify 过的字符串，pretty-print 一下方便看；
// 不是合法 JSON（比如就是个纯字符串）就原样展示，不强行报错
function prettyJson(raw?: string): string {
  if (!raw) return "（无）";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
</script>

<template>
  <div class="task-timeline-panel">
    <div class="panel-title">调用时间轴</div>
    <div v-if="reversedLog.length === 0" class="empty">还没有调用记录</div>
    <t-timeline v-else theme="dot" layout="vertical">
      <t-timeline-item
        v-for="entry in reversedLog"
        :key="entry.id"
        :dot-color="dotColor(entry.state)"
        :label="entry.state === 'running' ? '进行中' : formatDuration(entry.durationMs)"
        class="timeline-item"
        @click="openDetail(entry)"
      >
        <div class="entry-model">{{ entry.model }}</div>
        <t-tag size="small" variant="light" class="entry-stage">{{ entry.stage }}</t-tag>
        <div class="entry-desc">{{ entry.describe }}</div>
      </t-timeline-item>
    </t-timeline>

    <t-dialog
      v-model:visible="detailVisible"
      :header="detailEntry ? `${detailEntry.model} · ${detailEntry.describe}` : ''"
      width="640px"
      :footer="false"
    >
      <template v-if="detailEntry">
        <div class="io-block">
          <div class="io-label">输入</div>
          <pre class="io-content">{{ prettyJson(detailEntry.input) }}</pre>
        </div>
        <div class="io-block">
          <div class="io-label">输出</div>
          <pre class="io-content">{{ prettyJson(detailEntry.output) }}</pre>
        </div>
      </template>
    </t-dialog>
  </div>
</template>

<style scoped>
.task-timeline-panel {
  width: 300px;
  flex: none;
  border-left: 1px solid var(--td-border-level-2-color, #e7e7e7);
  padding: 16px 14px;
  overflow-y: auto;
}
.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-secondary, #666);
  margin-bottom: 12px;
}
.empty {
  color: var(--td-text-color-placeholder, #999);
  font-size: 12px;
}
.timeline-item {
  cursor: pointer;
}
.entry-model {
  font-family: monospace;
  font-size: 12px;
  color: var(--td-brand-color, #0052d9);
}
.entry-stage {
  margin: 4px 0;
}
.entry-desc {
  font-size: 12px;
  color: var(--td-text-color-secondary, #666);
}
.io-block + .io-block {
  margin-top: 16px;
}
.io-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-secondary, #666);
  margin-bottom: 6px;
}
.io-content {
  background: var(--td-bg-color-component, #f3f3f3);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
