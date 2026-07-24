import fs from "fs";
import u from "@/utils";
import { assemblePlayable } from "@/agents/playableAgent";

(async () => {
  const plan = await u.db("ab_creativePlan").where("id", 6).first();
  if (!plan || plan.status !== "approved") throw new Error("plan id=6 不是 approved 状态，先跑 sessionAgentState/sessionAgentSocket smoketest");

  const [cutId] = await u.db("ab_bridgeCut").insert({ creativePlanId: 6, index: 0, type: "playableGame", status: "pending", createTime: Date.now() });
  console.log("created bridgeCut id:", cutId);

  const result = await assemblePlayable(cutId);
  console.log("装配结果:", JSON.stringify(result, null, 2));

  const bundleDir = u.getPath(["oss", "bridgeCut", String(cutId), "playable"]);
  const indexHtml = fs.readFileSync(`${bundleDir}/index.html`, "utf-8");
  const gameHtml = fs.readFileSync(`${bundleDir}/game/index.html`, "utf-8");

  const configMatch = indexHtml.match(/window\.PLAYABLE_CONFIG = (\{.*\});/);
  if (!configMatch) throw new Error("index.html 里没找到注入的 PLAYABLE_CONFIG");
  const injectedConfig = JSON.parse(configMatch[1]);
  console.log("注入的 config:", injectedConfig);
  if (injectedConfig.title !== result.config.title) throw new Error("注入的 title 和生成结果不一致");

  const manifestMatch = gameHtml.match(/window\.GAME_MANIFEST = (\{.*\});/);
  if (!manifestMatch) throw new Error("game/index.html 里没找到注入的 GAME_MANIFEST");
  const manifest = JSON.parse(manifestMatch[1]);
  console.log("注入的 manifest tiles 数量:", manifest.tiles.length);
  if (manifest.tiles.length !== 8) throw new Error(`预期 8 个 tile（DEFAULT_PAIRS），实际 ${manifest.tiles.length}`);

  const cutRow = await u.db("ab_bridgeCut").where("id", cutId).first();
  if (cutRow?.status !== "done") throw new Error(`预期 done，实际 ${cutRow?.status}`);

  console.log("\n✅ playableAgent smoketest 通过");
})().catch((err) => {
  console.error("❌ playableAgent smoketest 失败:", err);
  process.exit(1);
});
