<script setup lang="ts">
import { computed } from "vue";
import type { SessionProgress, StageStatus } from "@/stores/sessionAgent";

const props = defineProps<{
  progress: SessionProgress | null;
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
</script>

<template>
  <div v-if="progress" class="session-progress-panel">
    <t-steps :current="currentIndex" layout="horizontal" class="progress-steps">
      <t-step-item v-for="stage in progress.stages" :key="stage.key" :title="stage.label" :status="toStepStatus(stage.status)" />
    </t-steps>
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
</style>
