/**
 * Google 官方 Gemini API 供应商适配——直连 generativelanguage.googleapis.com，不经过第三方中转。
 * @version 1.0
 *
 * 说明：
 * 1) 目前只接图片生成/编辑（Nano Banana / Gemini Flash Image 系列），走 generateContent 接口的
 *    多模态输出（responseModalities 里要 IMAGE），不是 Imagen 那条 predict 接口。
 * 2) 鉴权用 AI Studio（aistudio.google.com/apikey）生成的 API Key，走 `x-goog-api-key` 请求头，
 *    不需要 OAuth/服务账号那一套；请求地址支持配置，不填就用官方默认地址。
 * 3) 参考图/生成结果都是 inline base64（`inlineData.data`），没有中转服务那种"提交任务再轮询"的
 *    异步模式，一次请求直接拿到结果，天然不需要 pollTask。
 */
// ============================================================
// 类型定义
// ============================================================
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
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel)[];
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
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: any, m: any) => Promise<string>;
  ttsRequest: (c: any, m: any) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "google",
  version: "1.0",
  author: "contextual-ad-agent",
  name: "Google Gemini 官方接口",
  description: "Google AI Studio 官方 Gemini API，直连不经过中转，目前只接图片生成/编辑。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "AI Studio (aistudio.google.com/apikey) 生成的 API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: false, placeholder: "https://generativelanguage.googleapis.com/v1beta" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  models: [{ name: "Gemini 3.1 Flash Image", modelName: "gemini-3.1-flash-image", type: "image", mode: ["text", "singleImage", "multiReference"] }],
};
// ============================================================
// 辅助工具
// ============================================================
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const getBaseUrl = () => vendor.inputValues.baseUrl || DEFAULT_BASE_URL;
const IMAGE_REQUEST_TIMEOUT_MS = 130000; // 和 openai.ts 保持一致的超时兜底思路

// aspectRatio（宽:高）映射到 Gemini 图片生成支持的比例枚举
function mapAspectRatio(aspectRatio: `${number}:${number}`): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (w === h) return "1:1";
  return w > h ? "16:9" : "9:16";
}

// ============================================================
// 适配器函数
// ============================================================
const textRequest = () => {
  throw new Error("Google 供应商目前只接了图片生成，文本模型请用 anthropic 等其他供应商。");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  const parts: any[] = [{ text: config.prompt }];
  for (const ref of config.referenceList ?? []) {
    const b64 = ref.base64.replace(/^data:[^;]+;base64,/, "");
    parts.push({ inlineData: { mimeType: "image/png", data: b64 } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: mapAspectRatio(config.aspectRatio) },
    },
  };

  logger(`开始提交图片生成任务，模型：${model.modelName}（参考图 ${config.referenceList?.length ?? 0} 张）`);
  let resp: any;
  try {
    resp = await axios.post(`${getBaseUrl()}/models/${model.modelName}:generateContent`, body, {
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      timeout: IMAGE_REQUEST_TIMEOUT_MS,
    });
  } catch (e: any) {
    if (e?.code === "ECONNABORTED") throw new Error(`图片生成请求超过 ${IMAGE_REQUEST_TIMEOUT_MS / 1000} 秒未响应，判定为卡住，已主动放弃`);
    const errBody = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
    throw new Error(`图片生成失败：${errBody}`);
  }

  const responseParts = resp.data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p: any) => p.inlineData);
  if (!imagePart) throw new Error(`图片生成返回异常：${JSON.stringify(resp.data).slice(0, 500)}`);
  logger(`图片生成完成`);
  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
};

const videoRequest = async (): Promise<string> => "";
const ttsRequest = async (): Promise<string> => "";
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: vendor.version, notice: "" };
};
const updateVendor = async (): Promise<string> => "";
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
