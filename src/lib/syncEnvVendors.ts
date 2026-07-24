import { Knex } from "knex";

/**
 * 把 .env 里配置的供应商 key 同步进 o_vendorConfig，每次启动都跑一遍（幂等）。
 * 只有对应的 *_API_KEY 环境变量非空时才会动这个供应商的配置——不设就完全不touch，
 * 不会拿空值把数据库里已经配置好的 key 冲掉。
 *
 * 加新供应商时，在这个数组里加一行就行，不用改同步逻辑本身。
 */
const ENV_VENDOR_MAP: { vendorId: string; apiKeyEnv: string; baseUrlEnv: string }[] = [
  { vendorId: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", baseUrlEnv: "ANTHROPIC_BASE_URL" },
  { vendorId: "imarouter", apiKeyEnv: "IMAROUTER_API_KEY", baseUrlEnv: "IMAROUTER_BASE_URL" },
];

export default async function syncEnvVendors(knex: Knex): Promise<void> {
  for (const { vendorId, apiKeyEnv, baseUrlEnv } of ENV_VENDOR_MAP) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) continue; // .env 没配这个供应商，跳过

    const row = await knex("o_vendorConfig").where("id", vendorId).first();
    if (!row) continue; // 供应商文件还没被自动注册（fixDB 里的供应商注册循环会先跑，正常不会走到这）

    const currentInputValues = JSON.parse(row.inputValues || "{}");
    const baseUrl = process.env[baseUrlEnv];
    const nextInputValues = {
      ...currentInputValues,
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
    };

    const unchanged = JSON.stringify(currentInputValues) === JSON.stringify(nextInputValues) && row.enable === 1;
    if (unchanged) continue;

    await knex("o_vendorConfig")
      .where("id", vendorId)
      .update({ inputValues: JSON.stringify(nextInputValues), enable: 1 });
    // 只打印"同步了哪个供应商"，绝不打印密钥内容
    console.log(`[环境变量同步] 已从 .env 同步 ${vendorId} 的配置`);
  }
}
