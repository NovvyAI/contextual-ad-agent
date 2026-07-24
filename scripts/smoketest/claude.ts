import u from "@/utils";

// 前提：o_vendorConfig 里 id="anthropic" 的一行已经配置好真实 apiKey 并 enable=1。
// 运行：npx tsx scripts/smoketest/claude.ts
(async () => {
  const res = await u.Ai.Text("anthropic:claude-opus-4-8").invoke({
    messages: [{ role: "user", content: "Reply with exactly: OK" }],
  });
  console.log("Claude smoke test result:", res.text);
})().catch((err) => {
  console.error("Claude smoke test failed:", err);
  process.exit(1);
});
