/**
 * ImaRouter (Seedance 视频) 供应商适配
 * @version 1.0
 *
 * 说明：
 * 1) 只接视频生成，和 ads-gen-agent-main 的 tools/seedance.py 走的是同一个平台/同一套接口契约
 * 2) 提交任务 POST {baseUrl}/v1/videos，轮询 GET {baseUrl}/v1/videos/{id}
 * 3) 时长只接受 4/5/6/8/10/12/15 秒（ImaRouter Seedance 的硬性限制）
 * 4) 参考图/参考视频：ads-gen-agent-main 那边是先传 GCS 拿一个可访问的 URL 再传给 ImaRouter；
 *    我们这套供应商系统里参考素材是 base64，没有等价的"先传对象存储拿URL"能力，这里先按
 *    data URI 直接传（大多数兼容 OpenAI 风格的多模态接口能接受），未经过完整验证，纯文本
 *    生成（mode: text）这条路径是明确验证过、优先保证能用的。
 */
// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string; disabled?: boolean }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };
interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}
interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "imarouter",
  version: "1.0",
  author: "ad-bridge-agent",
  name: "ImaRouter (Seedance)",
  description: "ImaRouter 模型路由平台，视频生成接口，和 ads-gen-agent-main 使用同一个平台/同一套接口契约。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "ImaRouter API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://api.imarouter.com" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.imarouter.com",
  },
  models: [
    {
      name: "Seedance 2.0",
      modelName: "seedance-2.0",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:1", "videoReference:1", "audioReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 8, 10, 12, 15], resolution: ["480p", "720p", "1080p"] }],
    },
  ],
};
// ============================================================
// 辅助函数
// ============================================================
const ALLOWED_DURATIONS = [4, 5, 6, 8, 10, 12, 15];
const TERMINAL_OK = ["succeeded", "completed", "success"];
const TERMINAL_FAIL = ["failed", "error", "cancelled", "canceled"];

const getBaseUrl = () => (vendor.inputValues.baseUrl || "https://api.imarouter.com").replace(/\/+$/, "");

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
};

const clampDuration = (duration: number): number => {
  if (ALLOWED_DURATIONS.includes(duration)) return duration;
  // 取最接近的一个允许值，而不是直接报错，体验更好
  return ALLOWED_DURATIONS.reduce((best, d) => (Math.abs(d - duration) < Math.abs(best - duration) ? d : best));
};

const extractVideoUrl = (result: any): string | null => {
  const candidates: (string | undefined)[] = [];
  if (Array.isArray(result?.results)) {
    for (const item of result.results) {
      if (item && typeof item === "object" && item.url) candidates.push(item.url);
      else if (typeof item === "string") candidates.push(item);
    }
  }
  if (result?.metadata?.url) candidates.push(result.metadata.url);
  if (result?.video_url) candidates.push(result.video_url);
  if (result?.output) {
    if (typeof result.output === "object" && result.output.url) candidates.push(result.output.url);
    else if (typeof result.output === "string") candidates.push(result.output);
  }
  return candidates.find((c) => Boolean(c)) ?? null;
};

// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("ImaRouter 供应商目前只接了视频生成，文本模型请用 anthropic 等其他供应商。");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const headers = getHeaders();
  const duration = clampDuration(config.duration);

  const imageRefs = (config.referenceList || []).filter((r) => r.type === "image").map((r) => `data:image/png;base64,${r.base64}`);
  const videoRefs = (config.referenceList || []).filter((r) => r.type === "video").map((r) => `data:video/mp4;base64,${r.base64}`);
  const audioRefs = (config.referenceList || []).filter((r) => r.type === "audio").map((r) => `data:audio/mp3;base64,${r.base64}`);

  const body: any = {
    model: model.modelName,
    prompt: config.prompt || "",
    duration,
    metadata: { resolution: config.resolution || "1080p" },
  };
  if (config.aspectRatio) body.aspect_ratio = config.aspectRatio;
  if (videoRefs.length > 0) body.video_url = videoRefs[0];
  if (imageRefs.length > 0) body.images = imageRefs;
  if (audioRefs.length > 0) body.metadata.reference_audio_urls = audioRefs;

  logger(`[ImaRouter 视频] 提交任务: ${model.modelName}, duration=${duration}, imageRefs=${imageRefs.length}`);
  const submitResp = await axios.post(`${getBaseUrl()}/v1/videos`, body, { headers });
  const taskId = submitResp.data?.id || submitResp.data?.task_id;
  if (!taskId) {
    throw new Error(`视频任务提交失败：未获取到任务ID。原始响应：${JSON.stringify(submitResp.data).slice(0, 500)}`);
  }

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const resultResp = await axios.get(`${getBaseUrl()}/v1/videos/${taskId}`, { headers });
      const data = resultResp.data;
      const status = String(data?.status ?? "").toLowerCase();

      if (TERMINAL_OK.includes(status)) {
        const videoUrl = extractVideoUrl(data);
        if (videoUrl) return { completed: true, data: videoUrl };
        return { completed: true, error: "任务成功但未返回视频地址" };
      }
      if (TERMINAL_FAIL.includes(status)) {
        const detail = data?.error?.message ? ` — ${String(data.error.message).slice(0, 500)}` : "";
        return { completed: true, error: `视频生成失败: ${status}${detail}` };
      }
      return { completed: false };
    },
    5000,
    900000,
  );

  if (pollResult.error) throw new Error(pollResult.error);
  if (!pollResult.data) throw new Error("视频生成失败：轮询未返回数据");
  return await urlToBase64(pollResult.data);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: vendor.version, notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};
// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;
export {};
