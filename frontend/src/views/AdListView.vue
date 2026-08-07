<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";
import LocalFilePicker from "@/components/common/LocalFilePicker.vue";

const router = useRouter();

interface AdRow {
  id: number;
  name: string;
  adType: string; // 新记录是 CSV（如 "image,video"），老记录是单值（"image"/"video"/"text"）
  status: string;
  brandName: string | null;
  sourceFilePath: string | null; // 老数据兼容字段
  imageFilePath: string | null;
  videoFilePath: string | null;
  textContent: string | null;
  analysisResult: string | null;
  createTime: number;
}

const ads = ref<AdRow[]>([]);
const loading = ref(false);
const creating = ref(false);

const newName = ref("");
const newImageFilePath = ref("");
const newVideoFilePath = ref("");
const newTextContent = ref("");
const newBrandName = ref("");

const editDialogVisible = ref(false);
const editing = ref(false);
const editAdId = ref<number | null>(null);
const editName = ref("");
const editBrandName = ref("");
const editImageFilePath = ref("");
const editVideoFilePath = ref("");
const editTextContent = ref("");

async function loadAds() {
  loading.value = true;
  try {
    const res = (await http.post("/api/ad/getAdListAll")) as any;
    ads.value = res.data;
  } finally {
    loading.value = false;
  }
}

const adTypeLabel: Record<string, string> = { image: "图片", video: "视频", text: "纯文字" };
function formatAdType(adType: string): string {
  return adType
    .split(",")
    .filter(Boolean)
    .map((t) => adTypeLabel[t] ?? t)
    .join("+");
}

// 兼容老数据（单值 adType+sourceFilePath）：新字段有值就用新字段，没有就按老 adType 判断要不要回退到 sourceFilePath
function resolveImagePath(row: AdRow): string {
  return row.imageFilePath ?? (row.adType === "image" ? (row.sourceFilePath ?? "") : "");
}
function resolveVideoPath(row: AdRow): string {
  return row.videoFilePath ?? (row.adType === "video" ? (row.sourceFilePath ?? "") : "");
}

async function handleCreate() {
  if (!newName.value) return MessagePlugin.warning("请填写名称");
  if (!newImageFilePath.value && !newVideoFilePath.value && !newTextContent.value) {
    return MessagePlugin.warning("图片/视频/文案至少要填一种");
  }
  creating.value = true;
  try {
    await http.post("/api/ad/createAd", {
      name: newName.value,
      imageFilePath: newImageFilePath.value || undefined,
      videoFilePath: newVideoFilePath.value || undefined,
      textContent: newTextContent.value || undefined,
      brandName: newBrandName.value || undefined,
    });
    newName.value = "";
    newImageFilePath.value = "";
    newVideoFilePath.value = "";
    newTextContent.value = "";
    newBrandName.value = "";
    MessagePlugin.success("营销素材创建成功");
    await loadAds();
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
    await loadAds();
    if (!ads.value.some((a) => a.status === "analyzing")) {
      clearInterval(pollTimer!);
      pollTimer = null;
    }
  }, 3000);
}

async function handleAnalyze(adId: number) {
  await http.post("/api/ad/analyzeAd", { adIds: [adId] });
  MessagePlugin.info("已开始分析，完成后会自动刷新状态");
  await loadAds();
  pollUntilSettled();
}

function openEditDialog(row: AdRow) {
  editAdId.value = row.id;
  editName.value = row.name;
  editBrandName.value = row.brandName ?? "";
  editImageFilePath.value = resolveImagePath(row);
  editVideoFilePath.value = resolveVideoPath(row);
  editTextContent.value = row.textContent ?? "";
  editDialogVisible.value = true;
}

async function handleEditSubmit() {
  if (!editAdId.value || !editName.value) return;
  if (!editImageFilePath.value && !editVideoFilePath.value && !editTextContent.value) {
    return MessagePlugin.warning("图片/视频/文案至少要填一种");
  }
  editing.value = true;
  try {
    const res = (await http.post("/api/ad/updateAd", {
      adId: editAdId.value,
      name: editName.value,
      brandName: editBrandName.value || undefined,
      imageFilePath: editImageFilePath.value || undefined,
      videoFilePath: editVideoFilePath.value || undefined,
      textContent: editTextContent.value || undefined,
    })) as any;
    MessagePlugin.success(res.data?.contentChanged ? "已保存，内容已变更，需要重新点击「开始分析」" : "已保存");
    editDialogVisible.value = false;
    await loadAds();
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "保存失败");
  } finally {
    editing.value = false;
  }
}

async function handleDelete(adId: number) {
  try {
    await http.post("/api/ad/deleteAd", { adId });
    MessagePlugin.success("已删除");
    await loadAds();
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
  await loadAds();
  if (ads.value.some((a) => a.status === "analyzing")) pollUntilSettled();
});
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div style="padding: 24px; max-width: 960px; margin: 0 auto">
    <t-card title="新建营销素材" style="margin-bottom: 24px">
      <t-space direction="vertical" style="width: 100%">
        <t-space>
          <t-input v-model="newName" placeholder="名称" />
          <t-input v-model="newBrandName" placeholder="品牌名（可选）" />
        </t-space>
        <p style="margin: 0; color: var(--td-text-color-secondary, #666); font-size: 12px">
          图片/视频/文案可以只填一种，也可以同时填多种——不管填了几种，都只算一条素材、一个 ID。
        </p>
        <t-space>
          <t-input v-model="newImageFilePath" placeholder="图片文件路径（可选）" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (newImageFilePath = p)" />
        </t-space>
        <t-space>
          <t-input v-model="newVideoFilePath" placeholder="视频文件路径（可选）" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (newVideoFilePath = p)" />
        </t-space>
        <t-textarea v-model="newTextContent" placeholder="文案内容（可选）" />
        <t-button theme="primary" :loading="creating" @click="handleCreate">创建</t-button>
      </t-space>
    </t-card>

    <t-table :data="ads" :loading="loading" row-key="id" :columns="[
      { colKey: 'id', title: 'ID', width: 60 },
      { colKey: 'name', title: '名称' },
      { colKey: 'adType', title: '类型', width: 100 },
      { colKey: 'status', title: '状态' },
      { colKey: 'op', title: '操作', width: 260 },
    ]">
      <template #adType="{ row }">{{ formatAdType(row.adType) }}</template>
      <template #status="{ row }">
        <t-tag :theme="statusTheme[row.status] ?? 'default'" variant="light">{{ row.status }}</t-tag>
      </template>
      <template #op="{ row }">
        <t-space>
          <t-button v-if="row.status === 'uploaded'" size="small" @click="handleAnalyze(row.id)">开始分析</t-button>
          <t-button v-if="row.status === 'analyzed'" size="small" theme="primary" variant="outline" @click="router.push(`/ads/${row.id}`)">查看分析结果</t-button>
          <t-button size="small" variant="outline" @click="openEditDialog(row)">编辑</t-button>
          <t-popconfirm content="确定删除这条营销素材吗？关联的创意方案/内容也会一起删除" theme="danger" @confirm="handleDelete(row.id)">
            <t-button size="small" theme="danger" variant="outline">删除</t-button>
          </t-popconfirm>
        </t-space>
      </template>
    </t-table>

    <t-dialog
      v-model:visible="editDialogVisible"
      header="编辑营销素材"
      :confirm-btn="{ content: '保存', loading: editing }"
      :on-confirm="handleEditSubmit"
    >
      <t-space direction="vertical" style="width: 100%">
        <t-input v-model="editName" placeholder="名称" />
        <t-input v-model="editBrandName" placeholder="品牌名（可选）" />
        <t-space>
          <t-input v-model="editImageFilePath" placeholder="图片文件路径（可选）" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (editImageFilePath = p)" />
        </t-space>
        <t-space>
          <t-input v-model="editVideoFilePath" placeholder="视频文件路径（可选）" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (editVideoFilePath = p)" />
        </t-space>
        <t-textarea v-model="editTextContent" placeholder="文案内容（可选）" />
        <p style="margin: 0; color: var(--td-text-color-secondary, #666); font-size: 12px">
          如果改动了图片/视频/文案，这条素材的分析结果会作废，保存后需要重新点击"开始分析"；只改名称/品牌名不影响已有分析结果。
        </p>
      </t-space>
    </t-dialog>
  </div>
</template>
