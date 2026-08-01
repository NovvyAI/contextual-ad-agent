<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";
import LocalFilePicker from "@/components/common/LocalFilePicker.vue";

interface AdRow {
  id: number;
  name: string;
  adType: "video" | "image" | "text";
  status: string;
  brandName: string | null;
  sourceFilePath: string | null;
  textContent: string | null;
  createTime: number;
}

const ads = ref<AdRow[]>([]);
const loading = ref(false);
const creating = ref(false);

const newName = ref("");
// 一次可以勾多种形式（图片+视频+纯文字甚至三个都选）——提交时按选中的每种形式各建一条独立的 ab_ad 记录，
// 不是把多种内容塞进同一条记录里；后续生成创意方案那一步本来就支持多选素材（ActionBar.vue 的
// selectedAdIds 数组），拆开建更简单，也不用改 AdLibraryAgent 按单一类型分支的分析管线
const newAdTypes = ref<("video" | "image" | "text")[]>(["image"]);
const newImageFilePath = ref("");
const newVideoFilePath = ref("");
const newTextContent = ref("");
const newBrandName = ref("");

const editDialogVisible = ref(false);
const editing = ref(false);
const editAdId = ref<number | null>(null);
const editAdType = ref<"video" | "image" | "text">("image");
const editName = ref("");
const editBrandName = ref("");
const editSourceFilePath = ref("");
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

const adTypeLabel: Record<"video" | "image" | "text", string> = { image: "图片", video: "视频", text: "纯文字" };

async function handleCreate() {
  if (!newName.value || newAdTypes.value.length === 0) return;
  // 提交前把每种选中形式对应的内容字段都校验一遍，避免建到一半才发现某个形式没填内容，
  // 前面已经建好的那几条留在列表里、后面的直接报错——用户体感会很奇怪
  if (newAdTypes.value.includes("image") && !newImageFilePath.value) return MessagePlugin.error("请填写图片文件路径");
  if (newAdTypes.value.includes("video") && !newVideoFilePath.value) return MessagePlugin.error("请填写视频文件路径");
  if (newAdTypes.value.includes("text") && !newTextContent.value) return MessagePlugin.error("请填写创意形式内容");
  creating.value = true;
  try {
    // 只选了一种形式时名称保持原样；选了多种时各条名称加上形式后缀，方便在列表里一眼看出这几条是同一次提交拆出来的
    const multi = newAdTypes.value.length > 1;
    for (const adType of newAdTypes.value) {
      await http.post("/api/ad/createAd", {
        name: multi ? `${newName.value}（${adTypeLabel[adType]}）` : newName.value,
        adType,
        sourceFilePath: adType === "image" ? newImageFilePath.value : adType === "video" ? newVideoFilePath.value : undefined,
        textContent: adType === "text" ? newTextContent.value : undefined,
        brandName: newBrandName.value || undefined,
      });
    }
    newName.value = "";
    newImageFilePath.value = "";
    newVideoFilePath.value = "";
    newTextContent.value = "";
    newBrandName.value = "";
    MessagePlugin.success(multi ? `已创建 ${newAdTypes.value.length} 条创意素材` : "创意素材创建成功");
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
  editAdType.value = row.adType;
  editName.value = row.name;
  editBrandName.value = row.brandName ?? "";
  editSourceFilePath.value = row.sourceFilePath ?? "";
  editTextContent.value = row.textContent ?? "";
  editDialogVisible.value = true;
}

async function handleEditSubmit() {
  if (!editAdId.value || !editName.value) return;
  editing.value = true;
  try {
    const res = (await http.post("/api/ad/updateAd", {
      adId: editAdId.value,
      name: editName.value,
      brandName: editBrandName.value || undefined,
      sourceFilePath: editAdType.value === "text" ? undefined : editSourceFilePath.value,
      textContent: editAdType.value === "text" ? editTextContent.value : undefined,
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
    <t-card title="新建创意素材" style="margin-bottom: 24px">
      <t-space direction="vertical" style="width: 100%">
        <t-space>
          <t-input v-model="newName" placeholder="名称" />
          <t-checkbox-group v-model="newAdTypes">
            <t-checkbox value="image" label="图片" />
            <t-checkbox value="video" label="视频" />
            <t-checkbox value="text" label="纯文字" />
          </t-checkbox-group>
          <t-input v-model="newBrandName" placeholder="品牌名（可选）" />
        </t-space>
        <p v-if="newAdTypes.length > 1" style="margin: 0; color: var(--td-text-color-secondary, #666); font-size: 12px">
          勾了多种形式，提交后会按每种形式各建一条独立的创意素材，名称会加上形式后缀，方便看出是同一次提交拆出来的。
        </p>
        <t-space v-if="newAdTypes.includes('image')">
          <t-input v-model="newImageFilePath" placeholder="图片文件路径" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (newImageFilePath = p)" />
        </t-space>
        <t-space v-if="newAdTypes.includes('video')">
          <t-input v-model="newVideoFilePath" placeholder="视频文件路径" style="width: 320px" />
          <LocalFilePicker @uploaded="(p) => (newVideoFilePath = p)" />
        </t-space>
        <t-textarea v-if="newAdTypes.includes('text')" v-model="newTextContent" placeholder="创意形式" />
        <t-button theme="primary" :loading="creating" @click="handleCreate">创建</t-button>
      </t-space>
    </t-card>

    <t-table :data="ads" :loading="loading" row-key="id" :columns="[
      { colKey: 'id', title: 'ID', width: 60 },
      { colKey: 'name', title: '名称' },
      { colKey: 'adType', title: '类型', width: 100 },
      { colKey: 'status', title: '状态' },
      { colKey: 'op', title: '操作', width: 200 },
    ]">
      <template #status="{ row }">
        <t-tag :theme="statusTheme[row.status] ?? 'default'" variant="light">{{ row.status }}</t-tag>
      </template>
      <template #op="{ row }">
        <t-space>
          <t-button v-if="row.status === 'uploaded'" size="small" @click="handleAnalyze(row.id)">开始分析</t-button>
          <t-button size="small" variant="outline" @click="openEditDialog(row)">编辑</t-button>
          <t-popconfirm content="确定删除这条创意素材吗？关联的创意方案/内容也会一起删除" theme="danger" @confirm="handleDelete(row.id)">
            <t-button size="small" theme="danger" variant="outline">删除</t-button>
          </t-popconfirm>
        </t-space>
      </template>
    </t-table>

    <t-dialog
      v-model:visible="editDialogVisible"
      header="编辑创意素材"
      :confirm-btn="{ content: '保存', loading: editing }"
      :on-confirm="handleEditSubmit"
    >
      <t-space direction="vertical" style="width: 100%">
        <t-input v-model="editName" placeholder="名称" />
        <t-input v-model="editBrandName" placeholder="品牌名（可选）" />
        <template v-if="editAdType === 'text'">
          <t-textarea v-model="editTextContent" placeholder="创意形式" />
        </template>
        <template v-else>
          <t-space>
            <t-input v-model="editSourceFilePath" placeholder="服务器本地文件路径" style="width: 320px" />
            <LocalFilePicker @uploaded="(p) => (editSourceFilePath = p)" />
          </t-space>
        </template>
        <p style="margin: 0; color: var(--td-text-color-secondary, #666); font-size: 12px">
          如果改动了{{ editAdType === "text" ? "文案" : "文件路径" }}，这条素材的分析结果会作废，保存后需要重新点击"开始分析"；只改名称/品牌名不影响已有分析结果。
        </p>
      </t-space>
    </t-dialog>
  </div>
</template>
