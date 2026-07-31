import { generateText, generateObject, streamText, wrapLanguageModel, stepCountIs, extractReasoningMiddleware } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import axios from "axios";
import { transform } from "sucrase";
import u from "@/utils";

// M0 阶段占位：真实的 Agent key 分类（sessionAgent/directorAgent/...）留给后续里程碑设计，
// 现在只保留一个通用占位 key，其余模型调用直接用字面量 "vendorId:modelName" 绕过 o_agentDeploy。
type AiType = "universalAi";

type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

const AiTypeValues: AiType[] = ["universalAi"];
async function resolveModelName(value: AiType | `${string}:${string}`): Promise<`${string}:${string}`> {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();

    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData?.modelName as `${number}:${string}`;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData?.modelName as `${number}:${string}`;
    }

    //未查到agentUseModeVal 维持原判断
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
    let modelName = null;

    if (!agentDeployData?.modelName) {
      const [mainly] = agentDeployData!.key!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      modelName = mainlyData.modelName;
    }
    modelName = agentDeployData?.modelName || modelName;
    return modelName as `${number}:${string}`;
  }
  return value as `${number}:${string}`;
}

async function getModelConfig(value: AiType | `${string}:${string}`) {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();
    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData;
    }

    //未查到 agentUseModelVal 维持原流程
    const agentDeployData = await u.db("o_agentDeploy").where("key", value).first();

    if (!agentDeployData?.modelName) {
      const [mainly] = agentDeployData!.key!.split(/:(.+)/);
      const mainlyData = await u.db("o_agentDeploy").where("key", mainly).first();
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      return mainlyData;
    }
    return agentDeployData;
  }
  return null;
}

async function getVendorTemplateFn(
  fnName: "textRequest",
  modelName: `${string}:${string}`,
): Promise<(think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any>;
async function getVendorTemplateFn(fnName: Exclude<FnName, "textRequest">, modelName: `${string}:${string}`): Promise<(input: any) => any>;
async function getVendorTemplateFn(fnName: FnName, modelName: `${string}:${string}`): Promise<any> {
  const [id, name] = modelName.split(/:(.+)/);
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();
  if (!vendorConfigData) throw new Error(`未找到供应商配置 id=${id}`);
  const modelList = await u.vendor.getModelList(id);
  const selectedModel = modelList.find((i: any) => i.modelName == name);
  if (!selectedModel) throw new Error(`未找到模型 ${name} id=${id}`);
  const code = u.vendor.getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const running = u.vm(jsCode);
  if (running.vendor) {
    Object.assign(running.vendor.inputValues, JSON.parse(vendorConfigData.inputValues ?? "{}"));
    running.vendor.models = modelList;
  }
  const fn = running[fnName];
  if (!fn) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${id}`);
  if (fnName == "textRequest")
    return (think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) => {
      const effectiveThink = think ?? !!selectedModel.think;
      return fn(selectedModel, effectiveThink, thinkLevel);
    };
  else return <T>(input: T) => fn(input, selectedModel);
}

async function withTaskRecord<T>(
  modelKey: AiType | `${string}:${string}`,
  taskClass: string,
  describe: string,
  relatedObjects: string,
  projectId: number,
  fn: (modelName: `${string}:${string}`, think: Boolean, thinkLevel: 0 | 1 | 2 | 3) => Promise<T>,
): Promise<T> {
  const modelName = await resolveModelName(modelKey);
  const [_, model] = modelName.split(/:(.+)/);
  const taskRecord = await u.task(projectId, taskClass, model, { describe: describe, content: relatedObjects });
  try {
    const result = await fn(modelName, false, 0);

    taskRecord(1);
    return result;
  } catch (e) {
    taskRecord(-1, u.error(e).message);
    throw new Error(u.error(e).message);
  }
}

async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      return `${base64}`;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
  throw new Error("urlToBase64 failed");
}
// M6 发现，两个中转商特有的兼容性问题，都靠 providerOptions.anthropic 规避：
// 1. 扩展思考（extended thinking）默认开启时，中转商返回的 thinking 内容块缺官方应有的 signature
//    字段，@ai-sdk/anthropic 的严格 Zod 校验直接判定整个响应 "Invalid JSON response"——关掉扩展思考规避。
// 2. generateObject 默认走 Anthropic 较新的原生结构化输出（output_config.format:json_schema），
//    这个中转商没能正确支持/转发这个较新 API 面，返回内容解析不出来，同样报 "Invalid JSON response"——
//    强制退回旧式的工具调用（tool-calling）方式做结构化输出，兼容性更好，这条路径已经用 curl 直接验证过可行。
// 调用方如显式传了自己的 providerOptions 会覆盖这两个默认值。
const DEFAULT_ANTHROPIC_PROVIDER_OPTIONS = {
  anthropic: { thinking: { type: "disabled" as const }, structuredOutputMode: "jsonTool" as const },
};

// ============ 大模型调用日志：每次调用都把输入输出打印到 terminal，非文本内容（图片/视频/音频）只打印摘要 ============
function isBinaryLike(value: unknown): value is Buffer | Uint8Array {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

const DATA_URI_RE = /^data:([\w./+-]+);base64,/i;

function looksLikeBase64(value: string): boolean {
  const withoutPrefix = value.replace(DATA_URI_RE, "");
  return withoutPrefix.length > 200 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(withoutPrefix.slice(0, 120));
}

/** 递归地把请求/响应对象里的二进制数据（Buffer/base64 字符串，含 data: URI 形式）替换成简短描述，其余字段原样保留 */
function summarizeForLog(value: any, keyHint?: string): any {
  if (value == null) return value;
  if (isBinaryLike(value)) return `[二进制数据，约 ${(value as Buffer).length} 字节]`;
  if (typeof value === "string") {
    const dataUriMatch = value.match(DATA_URI_RE);
    if (dataUriMatch || looksLikeBase64(value)) {
      const mediaType = dataUriMatch?.[1] ?? "";
      const kind = /audio/i.test(mediaType || keyHint || "") ? "音频" : /video/i.test(mediaType || keyHint || "") ? "视频" : "图片";
      return `[${kind} base64 数据，约 ${value.length} 字符]`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => summarizeForLog(v));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = summarizeForLog(v, k);
    return out;
  }
  return value;
}

function logModelCall(label: string, modelName: string, phase: "输入" | "输出", data: unknown) {
  console.log(`\n[大模型调用] ${label} | model=${modelName} | ${phase}:`);
  console.log(JSON.stringify(summarizeForLog(data), null, 2));
}

class AiText {
  private AiType: AiType | `${string}:${string}`;
  private think?: boolean;
  private thinkLevel: 0 | 1 | 2 | 3;
  constructor(AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) {
    this.AiType = AiType;
    this.think = think;
    this.thinkLevel = thinkLevel;
  }
  private async resolveModel(middleware?: any | any[]) {
    const switchAiDevTool = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    const sdkFn = await getVendorTemplateFn("textRequest", modelName);
    const baseModel = await sdkFn(this.think, this.thinkLevel);
    const mws = [
      ...(switchAiDevTool?.value === "1" ? [devToolsMiddleware()] : []),
      ...(middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : []),
    ];
    return mws.length > 0 ? wrapLanguageModel({ model: baseModel, middleware: mws.length === 1 ? mws[0] : mws }) : baseModel;
  }
  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    const modelName = await resolveModelName(this.AiType);
    logModelCall("Text.invoke", modelName, "输入", { system: input.system, messages: input.messages, tools: input.tools ? Object.keys(input.tools) : undefined });

    const result = await generateText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      providerOptions: DEFAULT_ANTHROPIC_PROVIDER_OPTIONS,
      ...input,
      model: await this.resolveModel(),
      ...(config?.temperature && { temperature: config.temperature }),
      ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
    } as Parameters<typeof generateText>[0]);

    logModelCall("Text.invoke", modelName, "输出", { text: result.text, toolCalls: result.toolCalls });
    return result;
  }
  /**
   * 结构化输出：内部走 generateObject（对 Anthropic 是强制走 tool-calling 拿结构化结果），
   * 比"提示词里要求输出 JSON 再手动 parse"更可靠——顺带拿到 Zod 校验，格式不对直接抛错，
   * 不会把脏数据写进库里。
   */
  async invokeObject<T>(
    input: Omit<Parameters<typeof generateObject>[0], "model"> & { schema: import("zod").ZodType<T> },
    taskRecord?: TaskRecord,
  ) {
    const config = await getModelConfig(this.AiType);
    const modelName = await resolveModelName(this.AiType);
    const exec = async () => {
      logModelCall("Text.invokeObject", modelName, "输入", { system: input.system, messages: input.messages });
      const result = (await generateObject({
        providerOptions: DEFAULT_ANTHROPIC_PROVIDER_OPTIONS,
        ...input,
        model: await this.resolveModel(),
        ...(config?.temperature && { temperature: config.temperature }),
        ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
      } as Parameters<typeof generateObject>[0])) as { object: T } & Record<string, any>;
      logModelCall("Text.invokeObject", modelName, "输出", { object: result.object });
      return result;
    };

    if (taskRecord) {
      return withTaskRecord(this.AiType, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    }
    return exec();
  }
  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    const modelName = await resolveModelName(this.AiType);
    logModelCall("Text.stream", modelName, "输入", { system: input.system, messages: input.messages, tools: input.tools ? Object.keys(input.tools) : undefined });

    const result = streamText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      providerOptions: DEFAULT_ANTHROPIC_PROVIDER_OPTIONS,
      ...input,
      model: await this.resolveModel(extractReasoningMiddleware({ tagName: "reasoning_content", separator: "\n" })),
      ...(config?.temperature && { temperature: config.temperature }),
      ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
    } as Parameters<typeof streamText>[0]);

    // 流式调用拿不到一次性的"输出"，用一个透传的 async generator 包一层 fullStream：
    // 逐块转发给调用方的同时累积文本，等流真正消费完（或提前中断/报错）再打印一次完整输出
    const originalFullStream = result.fullStream;
    const wrappedFullStream = (async function* () {
      let accumulated = "";
      try {
        for await (const chunk of originalFullStream) {
          if ((chunk as any).type === "text-delta") accumulated += (chunk as any).text ?? "";
          yield chunk;
        }
      } finally {
        logModelCall("Text.stream", modelName, "输出", { text: accumulated });
      }
    })();

    return { ...result, fullStream: wrappedFullStream } as unknown as typeof result;
  }
}

function referenceList2imageBase642(id: string, input: any) {
  const version = u.vendor.getVendor(id).version;
  if (!version || isNaN(parseFloat(version)) || parseFloat(version) < 2.0) {
    // referenceList 在纯文本/无参考图生成时本来就不存在，不是异常情况
    input.imageBase64 = (input.referenceList ?? []).map((item: any) => item.base64);
    return input;
  }
  return input;
}

// image 类型的 url 是可选的公网可访问地址（比如 OSS 已经落盘的产物）——有些供应商（如 ImaRouter/Seedance）
// 的素材合规审核流程要求传一个可公网抓取的真实 url，不接受 base64 临时直链，供应商脚本按需选用
export type ReferenceList = { type: "image"; base64: string; url?: string } | { type: "audio"; base64: string } | { type: "video"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

export interface TaskRecord {
  taskClass: string; // 任务分类
  describe: string; // 任务描述
  relatedObjects: string; // 相关对象信息，便于后续分析和追踪
  projectId: number; // 项目ID
}

class AiImage {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      logModelCall("Image.run", mn, "输入", input);
      const fn = await getVendorTemplateFn("imageRequest", mn);
      await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
      this.result = await fn(input);
      if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      logModelCall("Image.run", mn, "输出", { imageResult: this.result });
      return this;
    };
    if (taskRecord) {
      await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
      return this;
    }
    await exec(modelName);
    return this;
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

type VideoMode =
  | "singleImage" //单图参考
  | "startEndRequired" //首尾帧（两张都得有）
  | "endFrameOptional" //首尾帧（尾帧可选）
  | "startFrameOptional" //首尾帧（首帧可选）
  | "text" //文本
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[]; //多参考（数字代表限制数量）

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

class AiVideo {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    try {
      const exec = async (mn: `${string}:${string}`) => {
        logModelCall("Video.run", mn, "输入", input);
        const fn = await getVendorTemplateFn("videoRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);

        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
        logModelCall("Video.run", mn, "输出", { videoResult: this.result });
      };
      if (taskRecord) {
        await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
        return this;
      }
      await exec(modelName);
      return this;
    } catch (e) {
      throw e;
    }
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiAudio {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      try {
        logModelCall("Audio.run", mn, "输入", input);
        const fn = await getVendorTemplateFn("ttsRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
        logModelCall("Audio.run", mn, "输出", { audioResult: this.result });
        return this;
      } catch (e) {}
    };
    if (taskRecord) {
      return withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    }
    return await exec(modelName);
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

export default {
  Text: (AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => new AiText(AiType, think, thinkLevel),
  Image: (key: `${string}:${string}`) => new AiImage(key),
  Video: (key: `${string}:${string}`) => new AiVideo(key),
  Audio: (key: `${string}:${string}`) => new AiAudio(key),
};
