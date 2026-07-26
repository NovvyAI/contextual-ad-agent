import u from "@/utils";
import fs from "fs";
import path from "path";
import { Knex } from "knex";
import { transform } from "sucrase";

export default async (knex: Knex): Promise<void> => {
  /**
   * 增量迁移辅助函数（表已存在后，字段级别的演进）。
   * 用传入的 knex 实例操作，避免和 @/utils 之间产生循环 import。
   */
  const addColumn = async (table: string, column: string, type: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (!(await knex.schema.hasColumn(table, column))) {
      await knex.schema.alterTable(table, (t) => (t as any)[type](column));
    }
  };

  const dropColumn = async (table: string, column: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  };

  const alterColumnType = async (table: string, column: string, type: string) => {
    if (!(await knex.schema.hasTable(table))) return;
    if (await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => {
        (t as any)[type](column).alter();
      });
    }
  };

  /**
   * 把一张普通 integer 主键的表迁移成 AUTOINCREMENT（SQLite 不支持 ALTER TABLE 直接改主键类型，
   * 只能建一张新表 + 搬数据 + 删旧表 + 改名）。用 sqlite_master 里的建表 SQL 判断是否已经迁移过，
   * 迁移过就跳过，保证这个函数在每次启动时调用都是幂等的。
   */
  const convertToAutoIncrement = async (table: string, builder: (t: Knex.CreateTableBuilder) => void) => {
    if (!(await knex.schema.hasTable(table))) return;
    const meta = await knex("sqlite_master").where({ type: "table", name: table }).first();
    if (meta?.sql && /autoincrement/i.test(meta.sql)) return;

    const columns = Object.keys(await knex(table).columnInfo());
    const tempTable = `${table}__migrating`;
    if (await knex.schema.hasTable(tempTable)) await knex.schema.dropTable(tempTable);

    await knex.raw("PRAGMA foreign_keys = OFF");
    try {
      await knex.schema.createTable(tempTable, builder);
      const columnList = columns.map((c) => `\`${c}\``).join(", ");
      await knex.raw(`INSERT INTO \`${tempTable}\` (${columnList}) SELECT ${columnList} FROM \`${table}\``);
      await knex.schema.dropTable(table);
      await knex.schema.renameTable(tempTable, table);
      console.log("[数据库迁移] 已迁移为 AUTOINCREMENT:", table);
    } finally {
      await knex.raw("PRAGMA foreign_keys = ON");
    }
  };
  // M1: StoryboardAgent / AdLibraryAgent 的结构化分析结果，存成 JSON blob 列
  await addColumn("ab_episode", "episodeAnalysis", "text");
  await addColumn("ab_ad", "textContent", "text");
  await addColumn("ab_ad", "analysisResult", "text");
  // ab_episode 建表时就有 errorReason，ab_ad 当时漏加了，这里补上，保持两张表状态字段对称
  await addColumn("ab_ad", "errorReason", "text");
  // M2: SessionAgent 驱动的会话工作流阶段，和 ab_episode.status（StoryboardAgent 的分析流水线状态）是两个不同的轴
  await addColumn("ab_episode", "workflowStage", "text");
  if (await knex.schema.hasTable("ab_episode")) {
    await knex("ab_episode").whereNull("workflowStage").update({ workflowStage: "uploaded" });
  }
  // M3: 执行层三个 Agent 共用 ab_generatedSegment 存生成产物。isSelected 标记同一个 (bridgeCutId, stage)
  // 下当前生效的那一行（重生成不覆盖旧行，插入新行 + 把旧行标记为非当前，天然保留重生成历史）；
  // stage 区分同一个 cut 下不同阶段的产物（VideoGenAgent 的 draftImage/finalRender，其余两个 Agent 只有 finalRender）。
  await addColumn("ab_generatedSegment", "isSelected", "integer");
  await addColumn("ab_generatedSegment", "stage", "text");
  // M6: 联调验收阶段要做分阶段耗时统计，o_tasks 补一列毫秒级耗时（taskRecord.ts 的 done() 里写入）
  await addColumn("o_tasks", "durationMs", "integer");
  // 加了删除功能之后才暴露的问题：普通 integer 主键删除后号码会被回收复用，新记录可能撞上刚删掉的
  // 旧记录的 id，导致前端按 id 缓存的会话状态串号、显示已删除数据。这几张业务表全部迁移成 AUTOINCREMENT，
  // 删过的 id 永不复用。builder 要和 initDB.ts 里对应表的最终定义保持一致。
  await convertToAutoIncrement("ab_episode", (t) => {
    t.increments("id");
    t.text("title");
    t.text("sourceFilePath");
    t.integer("durationMs");
    t.text("status");
    t.text("errorReason");
    t.integer("createTime");
    t.text("episodeAnalysis");
    t.text("workflowStage");
  });
  await convertToAutoIncrement("ab_ad", (t) => {
    t.increments("id");
    t.text("name");
    t.text("sourceFilePath");
    t.text("adType");
    t.text("brandName");
    t.text("status");
    t.integer("createTime");
    t.text("textContent");
    t.text("analysisResult");
    t.text("errorReason");
  });
  await convertToAutoIncrement("ab_creativePlan", (t) => {
    t.increments("id");
    t.integer("episodeId").unsigned().references("id").inTable("ab_episode");
    t.integer("adId").unsigned().references("id").inTable("ab_ad");
    t.text("narrative");
    t.text("tone");
    t.integer("planEvaluatorScore");
    t.text("status");
    t.integer("createTime");
  });
  await convertToAutoIncrement("ab_bridgeCut", (t) => {
    t.increments("id");
    t.integer("creativePlanId").unsigned().references("id").inTable("ab_creativePlan");
    t.integer("index");
    t.text("type");
    t.text("scriptText");
    t.integer("durationMs");
    t.text("prompt");
    t.text("status");
    t.integer("createTime");
  });
  await convertToAutoIncrement("ab_generatedSegment", (t) => {
    t.increments("id");
    t.integer("bridgeCutId").unsigned().references("id").inTable("ab_bridgeCut");
    t.text("model");
    t.text("filePath");
    t.text("state");
    t.text("errorReason");
    t.integer("createTime");
    t.integer("isSelected");
    t.text("stage");
  });
  await convertToAutoIncrement("ab_manifest", (t) => {
    t.increments("id");
    t.integer("episodeId").unsigned().references("id").inTable("ab_episode");
    t.integer("creativePlanId").unsigned().references("id").inTable("ab_creativePlan");
    t.text("finalFilePath");
    t.text("manifestJson");
    t.text("status");
    t.integer("createTime");
  });
  // M7：三选一桥接形式改成固定"过渡视频→H5 小游戏"两段式管线，DirectorAgent 不再需要 formatSequence 这一列
  await dropColumn("ab_creativePlan", "formatSequence");
  void alterColumnType;
  // 供应商自动注册：data/vendor/*.ts 里存在、但 o_vendorConfig 里还没有对应行的供应商，
  // 读取源码跑一遍沙箱拿到 vendor.id/inputValues，写入一行禁用状态的配置。
  // web-only 部署下 u.getPath("vendor") 就是仓库自带的 data/vendor 目录，文件天然已经就位，
  // 不需要像 Electron 打包那样通过 vendor.json 快照再落盘一次。
  const vendorDir = u.getPath("vendor");
  if (!fs.existsSync(vendorDir)) return;

  const files = fs.readdirSync(vendorDir).filter((f) => f.endsWith(".ts"));
  const existingIds = (await knex("o_vendorConfig").select("id")).map((r: any) => r.id);

  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    if (existingIds.includes(id)) continue;
    try {
      const tsCode = fs.readFileSync(path.join(vendorDir, file), "utf-8");
      const jsCode = transform(tsCode, { transforms: ["typescript"] }).code;
      const exportsObj = u.vm(jsCode);
      const vendor = exportsObj?.vendor;
      if (!vendor?.id) {
        console.warn(`[数据库迁移] 供应商文件缺少 vendor.id，跳过: ${file}`);
        continue;
      }
      await knex("o_vendorConfig").insert({
        id: vendor.id,
        inputValues: JSON.stringify(vendor.inputValues ?? {}),
        models: JSON.stringify([]),
        enable: 0,
      });
      console.log("[数据库迁移] 自动注册供应商:", vendor.id);
    } catch (err) {
      console.error(`[数据库迁移] 供应商文件解析失败，跳过: ${file}`, err);
    }
  }
};
