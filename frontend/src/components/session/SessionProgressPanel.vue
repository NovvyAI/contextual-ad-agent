<script setup lang="ts">
import { computed } from "vue";
import type { SessionProgress, TaskLogEntry, StageStatus } from "@/stores/sessionAgent";

const props = defineProps<{
  progress: SessionProgress | null;
  taskLog: TaskLogEntry[];
}>();

// t-step-item 的 status 只认 default/process/finish/error，和我们自己的 StageStatus 命名不完全一样
function toStepStatus(status: StageStatus): "default" | "process" | "finish" | "error" {
  if (status === "done") return "finish";
  if (status === "in_progress") return "process";
  if (status === "failed") return "error";
  return "default";
}

// t-steps 需要一个 current 值定位当前步骤（用第一个不是 done 的阶段索引；全部 done 就指向最后一步）
const currentIndex = computed(() => {
  const stages = props.progress?.stages ?? [];
  const idx = stages.findIndex((s) => s.status !== "done");
  return idx === -1 ? stages.length - 1 : idx;
});

// 最近的调用排在最前面，只展示最近 8 条，太长了页面会被挤爆
const recentTaskLog = computed(() => [...props.taskLog].reverse().slice(0, 8));

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
</script>

<template>
  <div v-if="progress" class="session-progress-panel">
    <t-steps :current="currentIndex" layout="horizontal" class="progress-steps">
      <t-step-item v-for="stage in progress.stages" :key="stage.key" :title="stage.label" :status="toStepStatus(stage.status)" />
    </t-steps>

    <div v-if="recentTaskLog.length > 0" class="task-log">
      <div v-for="entry in recentTaskLog" :key="entry.id" class="task-log-item">
        <t-tag v-if="entry.state === 'running'" theme="primary" variant="light" size="small">进行中</t-tag>
        <t-tag v-else-if="entry.state === 'done'" theme="success" variant="light" size="small">{{ formatDuration(entry.durationMs) }}</t-tag>
        <t-tag v-else theme="danger" variant="light" size="small">失败</t-tag>
        <span class="task-log-model">{{ entry.model }}</span>
        <span class="task-log-stage">{{ entry.stage }}</span>
        <span class="task-log-desc">{{ entry.describe }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-progress-panel {
  padding: 10px 16px;
  border-bottom: 1px solid var(--td-border-level-2-color, #e7e7e7);
  background: var(--td-bg-color-container, #fff);
}
.progress-steps {
  max-width: 100%;
  overflow-x: auto;
}
.task-log {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
}
.task-log-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.task-log-model {
  font-family: monospace;
  color: var(--td-brand-color, #0052d9);
  flex: none;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-log-stage {
  font-size: 11px;
  color: var(--td-text-color-placeholder, #999);
  background: var(--td-bg-color-component, #f3f3f3);
  border-radius: 3px;
  padding: 0 5px;
  flex: none;
  white-space: nowrap;
}
.task-log-desc {
  color: var(--td-text-color-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
