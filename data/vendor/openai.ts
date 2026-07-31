/**
 * Toonflow AI供应商模板
 * @version 2.0
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
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
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
declare const FormData: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
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
  id: "openai",
  version: "2.0",
  author: "Toonflow",
  name: "OpenAI标准接口",
  description: "OpenAI标准格式接口，可修改请求地址并手动添加模型。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://api.openai.com/v1" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
  },
  models: [
    { name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false },
    { name: "GPT-4.1", modelName: "gpt-4.1", type: "text", think: false },
    { name: "GPT-5.1", modelName: "gpt-5.1", type: "text", think: false },
    { name: "GPT-5.2", modelName: "gpt-5.2", type: "text", think: false },
    { name: "GPT-5.4", modelName: "gpt-5.4", type: "text", think: false },
    { name: "GPT Image 1", modelName: "gpt-image-1", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "GPT Image 2", modelName: "gpt-image-2", type: "image", mode: ["text", "singleImage", "multiReference"] },
  ],
};
// ============================================================
// 辅助工具
// ============================================================
const getHeaders = () => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${apiKey}` };
};

// aspectRatio（宽:高）映射到 gpt-image 系列支持的固定尺寸档位，没有正方形/竖屏/横屏之外的选项
function mapSize(aspectRatio: `${number}:${number}`): "1024x1024" | "1024x1536" | "1536x1024" {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
}

// gpt-image 系列没有"分辨率"档位，用 quality 近似映射 1K/2K/4K 的"越高越贵越细"语义
function mapQuality(size: "1K" | "2K" | "4K"): "low" | "medium" | "high" {
  return size === "1K" ? "low" : size === "2K" ? "medium" : "high";
}

// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};
// 中转服务自己的网关一般在 120 秒左右会主动掐断没有响应的请求、抛出 "Proxy Read Timeout" 之类的错误，
// 但实测遇到过请求卡在别的环节、既不报错也不返回、一直悬挂的情况——加一个比网关超时稍长一点的兜底，
// 保证这类请求最终一定会失败退出，而不是无限期占着不动，用户完全看不出是卡住了还是在正常处理
const IMAGE_REQUEST_TIMEOUT_MS = 130000;

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl;
  const headers = getHeaders();
  const size = mapSize(config.aspectRatio);
  const quality = mapQuality(config.size);

  let respJson: any;
  if (config.referenceList && config.referenceList.length > 0) {
    // 参考图存在：走 /images/edits，多张参考图用同名字段重复 append
    const form = new FormData();
    form.append("model", model.modelName);
    form.append("prompt", config.prompt);
    form.append("size", size);
    form.append("quality", quality);
    for (let i = 0; i < config.referenceList.length; i++) {
      const b64 = config.referenceList[i].base64.replace(/^data:[^;]+;base64,/, "");
      form.append("image[]", Buffer.from(b64, "base64"), { filename: `ref-${i}.png`, contentType: "image/png" });
    }
    logger(`开始提交图片编辑任务（${config.referenceList.length} 张参考图），模型：${model.modelName}`);
    let resp: any;
    try {
      resp = await axios.post(`${baseUrl}/images/edits`, form, { headers: { ...headers, ...form.getHeaders() }, timeout: IMAGE_REQUEST_TIMEOUT_MS });
    } catch (e: any) {
      if (e?.code === "ECONNABORTED") throw new Error(`图片编辑请求超过 ${IMAGE_REQUEST_TIMEOUT_MS / 1000} 秒未响应，判定为卡住，已主动放弃`);
      throw e;
    }
    respJson = resp.data;
  } else {
    logger(`开始提交文生图任务，模型：${model.modelName}`);
    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.modelName, prompt: config.prompt, size, quality, n: 1 }),
        signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") throw new Error(`文生图请求超过 ${IMAGE_REQUEST_TIMEOUT_MS / 1000} 秒未响应，判定为卡住，已主动放弃`);
      throw e;
    }
    if (!resp.ok) {
      const errorReason = await resp.text();
      throw new Error(`图片生成失败：${errorReason}`);
    }
    respJson = await resp.json();
  }

  const b64Json = respJson?.data?.[0]?.b64_json;
  if (!b64Json) throw new Error(`图片生成返回异常：${JSON.stringify(respJson)}`);
  logger(`图片生成完成`);
  return `data:image/png;base64,${b64Json}`;
};
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  return "";
};
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "2.0", notice: "" };
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