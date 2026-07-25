<script setup lang="ts">
import { ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";

const emit = defineEmits<{ (e: "uploaded", path: string, originalName: string): void }>();

const uploading = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

function triggerPick() {
  inputRef.value?.click();
}

async function handleChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = (await http.post("/api/upload/uploadFile", formData)) as any;
    emit("uploaded", res.data.path, res.data.originalName);
    MessagePlugin.success(`已上传：${res.data.originalName}`);
  } catch (err: any) {
    MessagePlugin.error(err?.message ?? "上传失败");
  } finally {
    uploading.value = false;
    if (inputRef.value) inputRef.value.value = "";
  }
}
</script>

<template>
  <span>
    <input ref="inputRef" type="file" style="display: none" @change="handleChange" />
    <t-button variant="outline" :loading="uploading" @click="triggerPick">选择本地文件</t-button>
  </span>
</template>
