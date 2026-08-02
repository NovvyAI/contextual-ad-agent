import { Knex } from "knex";
import { v4 as uuid } from "uuid";

interface TableSchema {
  name: string;
  builder: (table: Knex.CreateTableBuilder) => void;
  initData?: (knex: Knex) => Promise<void>;
}

export default async (knex: Knex, forceInit: boolean = false): Promise<void> => {
  const tables: TableSchema[] = [
    // 用户表
    {
      name: "o_user",
      builder: (table) => {
        table.integer("id").notNullable();
        table.text("name");
        table.text("password");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async (knex) => {
        await knex("o_user").insert([{ id: 1, name: "admin", password: "admin123" }]);
      },
    },
    // 设置表
    {
      name: "o_setting",
      builder: (table) => {
        table.text("key");
        table.text("value");
        table.primary(["key"]);
        table.unique(["key"]);
      },
      initData: async (knex) => {
        await knex("o_setting").insert([
          { key: "tokenKey", value: uuid().slice(0, 8) },
          { key: "messagesPerSummary", value: 10 },
          { key: "shortTermLimit", value: 5 },
          { key: "summaryMaxLength", value: 500 },
          { key: "summaryLimit", value: 10 },
          { key: "ragLimit", value: 3 },
          { key: "deepRetrieveSummaryLimit", value: 5 },
          { key: "modelOnnxFile", value: '["all-MiniLM-L6-v2", "onnx", "model_fp16.onnx"]' },
          { key: "modelDtype", value: "fp16" },
          { key: "switchAiDevTool", value: "0" },
          // 0 = 简易模式（一个主 Agent 共用一个模型配置），1 = 高级模式（每个子 Agent 单独配置）
          { key: "agentUseMode", value: "0" },
        ]);
      },
    },
    // Agent 模型部署表 — M0 阶段不预置真实 Agent 的 key，真实 taxonomy 留给后续里程碑
    {
      name: "o_agentDeploy",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("model");
        table.string("key");
        table.string("modelName");
        table.text("vendorId");
        table.string("desc");
        table.string("name");
        table.integer("temperature");
        table.integer("maxOutputTokens");
        table.boolean("disabled").defaultTo(false);
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async () => {},
    },
    // 任务中心表
    {
      name: "o_tasks",
      builder: (table) => {
        table.integer("id").notNullable();
        table.integer("projectId");
        table.string("taskClass");
        table.string("relatedObjects");
        table.string("model");
        table.text("describe");
        table.string("state");
        table.integer("startTime");
        table.integer("durationMs");
        table.text("reason");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async () => {},
    },
    // 供应商配置表 — 具体行由 fixDB.ts 的供应商自动注册逻辑按 data/vendor/*.ts 填充
    {
      name: "o_vendorConfig",
      builder: (table) => {
        table.string("id").notNullable();
        table.text("inputValues"); // 输入项值 JSON
        table.text("models"); // 模型配置 JSON
        table.integer("enable"); // 是否启用供应商
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async () => {},
    },
    // 提示词表 — 表结构复用 setting/promptManage 路由，种子数据留空（业务内容后续填充）
    {
      name: "o_prompt",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("name");
        table.string("type");
        table.text("data");
        table.text("useData");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async () => {},
    },
    // 模型绑定提示词表 — 表结构复用 setting/modelMap 路由，种子数据留空
    {
      name: "o_modelPrompt",
      builder: (table) => {
        table.integer("id").notNullable();
        table.string("vendorId");
        table.string("model");
        table.text("fileName");
        table.text("path");
        table.primary(["id"]);
        table.unique(["id"]);
      },
      initData: async () => {},
    },
    // Skill 文件索引表 — 表结构复用 setting/skillManagement 路由，种子数据留空
    {
      name: "o_skillList",
      builder: (table) => {
        table.text("id").notNullable();
        table.text("md5").notNullable();
        table.text("path").notNullable();
        table.text("name").notNullable();
        table.text("description").notNullable();
        table.text("embedding");
        table.text("type").notNullable(); // "main" | "references"
        table.integer("createTime").notNullable();
        table.integer("updateTime").notNullable();
        table.integer("state").notNullable();
        table.primary(["id"]);
      },
      initData: async () => {},
    },
    {
      name: "o_skillAttribution",
      builder: (table) => {
        table.text("skillId").notNullable().references("id").inTable("o_skillList").onDelete("CASCADE");
        table.text("attribution").notNullable();
        table.primary(["skillId", "attribution"]);
        table.index(["attribution"]);
      },
      initData: async () => {},
    },
    // 记忆表（message=原始消息, summary=压缩摘要）
    {
      name: "memories",
      builder: (table) => {
        table.text("id").notNullable();
        table.text("isolationKey").notNullable(); // 记忆隔离键
        table.text("type").notNullable(); // 'message' | 'summary'
        table.text("role"); // 'user' | 'assistant'
        table.text("name");
        table.text("content").notNullable();
        table.text("embedding"); // 向量嵌入 JSON
        table.text("relatedMessageIds"); // summary关联的message id列表 JSON
        table.integer("summarized").defaultTo(0); // message是否已被总结 0/1
        table.integer("createTime").notNullable();
        table.primary(["id"]);
        table.index(["isolationKey", "type"]);
        table.index(["isolationKey", "summarized"]);
      },
    },

    // ── contextual-ad-agent 业务表 ──

    // Episode（被分析的短剧单集）
    // id 用 increments（AUTOINCREMENT）而不是普通 integer 主键——这几张业务表都有删除功能，
    // 普通 integer 主键删除后号码会被回收复用，新记录可能撞上刚删掉的旧记录的 id，
    // 导致前端按 id 缓存的会话状态串号、显示已删除数据（真实踩过的坑，见 docs/CHANGELOG.md）。
    {
      name: "ab_episode",
      builder: (table) => {
        table.increments("id");
        table.text("title");
        table.text("sourceFilePath");
        table.integer("durationMs");
        table.text("status"); // uploaded | analyzing | analyzed | failed
        table.text("errorReason");
        table.integer("createTime");
      },
    },
    // 广告素材
    {
      name: "ab_ad",
      builder: (table) => {
        table.increments("id");
        table.text("name");
        table.text("sourceFilePath");
        table.text("adType"); // video | image | copy
        table.text("brandName");
        table.text("status");
        table.integer("createTime");
      },
    },
    // 创意方案（DirectorAgent 产出，可能是多种形式的混合脚本）
    {
      name: "ab_creativePlan",
      builder: (table) => {
        table.increments("id");
        table.integer("episodeId").unsigned().references("id").inTable("ab_episode");
        table.integer("adId").unsigned().references("id").inTable("ab_ad");
        table.text("narrative");
        table.text("tone");
        table.integer("planEvaluatorScore");
        table.text("status"); // draft | evaluating | approved | rejected
        table.integer("createTime");
        table.text("imageModelKey"); // 用户在内容生成前选定的图片生成模型，null 就是走系统默认
        table.text("videoModelKey"); // 用户在内容生成前选定的视频生成模型，null 就是走系统默认
        table.text("videoResolution"); // 用户在内容生成前选定的成片分辨率，null 就是走系统默认（1080p）
      },
    },
    // 分镜草案（已确认方案内的具体分镜/桥接段）
    {
      name: "ab_bridgeCut",
      builder: (table) => {
        table.increments("id");
        table.integer("creativePlanId").unsigned().references("id").inTable("ab_creativePlan");
        table.integer("index");
        table.text("type"); // video | playableGame（ctaCard 是 M2-M6 时期的历史值，M7 起不再生成）
        table.text("scriptText");
        table.integer("durationMs");
        table.text("prompt");
        table.text("status");
        table.integer("createTime");
      },
    },
    // 生成产出（针对某个分镜草案的实际生成结果，如渲染出的视频）
    {
      name: "ab_generatedSegment",
      builder: (table) => {
        table.increments("id");
        table.integer("bridgeCutId").unsigned().references("id").inTable("ab_bridgeCut");
        table.text("model");
        table.text("filePath");
        table.text("state"); // pending | generating | done | failed
        table.text("errorReason");
        table.integer("createTime");
      },
    },
    // 最终拼接输出
    {
      name: "ab_manifest",
      builder: (table) => {
        table.increments("id");
        table.integer("episodeId").unsigned().references("id").inTable("ab_episode");
        table.integer("creativePlanId").unsigned().references("id").inTable("ab_creativePlan");
        table.text("finalFilePath");
        table.text("manifestJson");
        table.text("status");
        table.integer("createTime");
      },
    },
    // revise 历史——方案/分镜草案/运镜专用/小游戏四种 revise 流程都会写一条，留给以后做训练数据用。
    // targetId 的含义随 targetType 变化（plan→planId，其余三种→bridgeCutId），不建外键约束。
    {
      name: "ab_reviseHistory",
      builder: (table) => {
        table.increments("id");
        table.text("targetType"); // plan | bridgeCutDraft | bridgeCutMotion | playable
        table.integer("targetId");
        table.text("feedback"); // 用户原始反馈——revise 流程里此前唯一没有落库的部分
        table.text("beforeState"); // JSON
        table.text("afterState"); // JSON
        table.integer("createTime");
      },
    },
  ];

  for (const t of tables) {
    const tableExists = await knex.schema.hasTable(t.name);
    if (!tableExists || forceInit) {
      if (tableExists && forceInit) {
        await knex.schema.dropTable(t.name);
        console.log("[初始化数据库] 已存在表删除并重建:", t.name);
      } else {
        console.log("[初始化数据库] 创建数据表:", t.name);
      }
      await knex.schema.createTable(t.name, t.builder);
      if (t.initData) {
        await t.initData(knex);
        console.log("[初始化数据库] 表数据初始化:", t.name);
      }
    }
  }
};
