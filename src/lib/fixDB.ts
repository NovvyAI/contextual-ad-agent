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
  // stage 区分同一个 cut 下不同阶段的产物（BridgeVideoAgent 的 draftImage/finalRender，其余两个 Agent 只有 finalRender）。
  await addColumn("ab_generatedSegment", "isSelected", "integer");
  await addColumn("ab_generatedSegment", "stage", "text");
  void dropColumn;
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
