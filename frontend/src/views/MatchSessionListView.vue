<script setup lang="ts">
// "匹配创作会话"列表——纯粹把一个 Episode 和一条营销素材配对，供并排查看两边分析结果，
// 不涉及聊天/生成创意方案（那套完整流程在 /episodes/:id，是另一个独立入口）。
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";

const router = useRouter();

interface MatchSessionRow {
  id: number;
  episodeId: number;
  episodeTitle: string;
  adId: number;
  adName: string;
  createTime: number;
}
interface EpisodeOption {
  id: number;
  title: string;
  status: string;
}
interface AdOption {
  id: number;
  name: string;
  status: string;
}

const list = ref<MatchSessionRow[]>([]);
const loading = ref(false);

const episodeOptions = ref<EpisodeOption[]>([]);
const adOptions = ref<AdOption[]>([]);

const createDialogVisible = ref(false);
const creating = ref(false);
const selectedEpisodeId = ref<number | undefined>(undefined);
const selectedAdId = ref<number | undefined>(undefined);

async function loadList() {
  loading.value = true;
  try {
    const res = (await http.post("/api/matchSession/getMatchSessionList")) as any;
    list.value = res.data;
  } finally {
    loading.value = false;
  }
}

async function openCreateDialog() {
  selectedEpisodeId.value = undefined;
  selectedAdId.value = undefined;
  createDialogVisible.value = true;
  // 只列已完成分析的——没分析完就没有内容可以并排看，创建了也是空的
  const [episodeRes, adRes] = await Promise.all([http.post("/api/episode/getEpisodeList"), http.post("/api/ad/getAdListAll")]);
  episodeOptions.value = ((episodeRes as any).data as EpisodeOption[]).filter((e) => e.status === "analyzed");
  adOptions.value = ((adRes as any).data as AdOption[]).filter((a) => a.status === "analyzed");
}

async function handleCreate() {
  if (!selectedEpisodeId.value || !selectedAdId.value) return MessagePlugin.warning("请选择 Episode 和营销素材");
  creating.value = true;
  try {
    const res = (await http.post("/api/matchSession/createMatchSession", {
      episodeId: selectedEpisodeId.value,
      adId: selectedAdId.value,
    })) as any;
    createDialogVisible.value = false;
    router.push(`/match-sessions/${res.data.id}`);
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "创建失败");
  } finally {
    creating.value = false;
  }
}

async function handleDelete(id: number) {
  try {
    await http.post("/api/matchSession/deleteMatchSession", { matchSessionId: id });
    MessagePlugin.success("已删除");
    await loadList();
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "删除失败");
  }
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

onMounted(loadList);
</script>

<template>
  <div style="padding: 24px; max-width: 900px; margin: 0 auto">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px">
      <h3 style="margin: 0">匹配创作会话</h3>
      <t-button theme="primary" @click="openCreateDialog">创建会话</t-button>
    </div>

    <t-table
      :data="list"
      :loading="loading"
      row-key="id"
      :columns="[
        { colKey: 'id', title: 'ID', width: 60 },
        { colKey: 'episodeTitle', title: 'Episode' },
        { colKey: 'adName', title: '营销素材' },
        { colKey: 'createTime', title: '创建时间' },
        { colKey: 'op', title: '操作', width: 160 },
      ]"
    >
      <template #createTime="{ row }">{{ formatTime(row.createTime) }}</template>
      <template #op="{ row }">
        <t-space>
          <t-button size="small" theme="primary" variant="outline" @click="router.push(`/match-sessions/${row.id}`)">查看详情</t-button>
          <t-popconfirm content="确定删除这条匹配创作会话吗？" theme="danger" @confirm="handleDelete(row.id)">
            <t-button size="small" theme="danger" variant="outline">删除</t-button>
          </t-popconfirm>
        </t-space>
      </template>
    </t-table>

    <t-dialog
      v-model:visible="createDialogVisible"
      header="创建匹配创作会话"
      :confirm-btn="{ content: '创建', loading: creating }"
      :on-confirm="handleCreate"
    >
      <t-space direction="vertical" style="width: 100%">
        <div>
          <div style="font-size: 12px; color: var(--td-text-color-secondary, #666); margin-bottom: 4px">Episode（只列已完成剧情分析的）</div>
          <t-select v-model="selectedEpisodeId" placeholder="选择 Episode" style="width: 100%">
            <t-option v-for="e in episodeOptions" :key="e.id" :value="e.id" :label="`#${e.id} ${e.title}`" />
          </t-select>
        </div>
        <div>
          <div style="font-size: 12px; color: var(--td-text-color-secondary, #666); margin-bottom: 4px">营销素材（只列已完成分析的）</div>
          <t-select v-model="selectedAdId" placeholder="选择营销素材" style="width: 100%">
            <t-option v-for="a in adOptions" :key="a.id" :value="a.id" :label="`#${a.id} ${a.name}`" />
          </t-select>
        </div>
      </t-space>
    </t-dialog>
  </div>
</template>
