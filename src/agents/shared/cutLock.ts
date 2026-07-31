const inProgress = new Set<number>();

/**
 * 进程内并发保护——同一个 bridgeCutId 不允许有两个生成/revise 调用同时在跑。
 * 真实复现过的 bug：几乎同时点两次"重试"（或按钮+聊天各触发一次），两次调用都在查完
 * cut.status 之后才开始跑耗时的模型调用，谁的失败/成功结果后写入数据库谁就生效，
 * 导致已经生成好的草案被后到的失败结果错误覆盖成 failed。
 * 用内存 Set 在函数最开始、没有任何 await 之前做同步检查+占用——JS 单线程保证这一步
 * 不会被另一个并发请求打断，比"先查数据库状态再判断"更可靠。跨进程/服务重启感知不到，
 * 但这个项目目前是单进程部署，够用。
 */
export function acquireCutLock(bridgeCutId: number): boolean {
  if (inProgress.has(bridgeCutId)) return false;
  inProgress.add(bridgeCutId);
  return true;
}

export function releaseCutLock(bridgeCutId: number): void {
  inProgress.delete(bridgeCutId);
}

export function cutBusyError(bridgeCutId: number): Error {
  return new Error(`Cut ${bridgeCutId} 正在生成中，请稍候，不要重复触发`);
}
