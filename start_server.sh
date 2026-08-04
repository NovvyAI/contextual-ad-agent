#!/usr/bin/env bash
# 同时启动后端（yarn dev）和前端（frontend/ 下的 vite dev server）。
# 日志分别写到项目根目录的 backend.log / frontend.log，用 tail -f 看；
# 按 Ctrl+C 或脚本退出时会把两个子进程一起停掉，不留孤儿进程。
set -euo pipefail

# 不依赖调用时的当前目录，永远用脚本自己所在的目录作为项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BACKEND_LOG="$ROOT_DIR/backend.log"
FRONTEND_LOG="$ROOT_DIR/frontend.log"

# 先清理可能残留的旧进程，避免端口被占用导致启动失败（nodemon/vite 异常退出时偶尔会有残留）。
# 匹配串只用 "src/app.ts"，不要加 "tsx" 前缀——nodemon → tsx 包装层 → 真正跑起来持有端口的那个
# node 进程，三层命令行长得都不一样（中间层是 "tsx --inspect src/app.ts"，最内层是
# "node --require .../tsx/dist/preflight.cjs ... --inspect src/app.ts"，压根不带 "tsx" 这个词），
# 之前用 "tsx src/app.ts" 只能命中中间层，最内层杀不掉，端口还占着，下次启动直接 EADDRINUSE，
# 还会造成两套完整的前后端同时跑、互相看不见对方状态这种更隐蔽的问题。
pkill -f "src/app.ts" >/dev/null 2>&1 || true
pkill -f "frontend/node_modules/.bin/vite" >/dev/null 2>&1 || true
sleep 1

pids=()

cleanup() {
  echo ""
  echo "正在停止服务..."
  for pid in "${pids[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  # yarn/vite 包起来的子进程不一定会跟着上面这个 kill 一起退出（yarn 不一定把信号转发给它拉起的
  # 实际进程），兜底按命令特征再杀一遍，不然脚本退出后端口还占着，下次启动会报 EADDRINUSE
  pkill -f "src/app.ts" >/dev/null 2>&1 || true
  pkill -f "frontend/node_modules/.bin/vite" >/dev/null 2>&1 || true
  wait >/dev/null 2>&1 || true
  echo "已停止。"
}
# INT/TERM 只负责触发退出，实际清理都放在 EXIT trap 里，避免同一次退出触发两次 cleanup
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "启动后端 (yarn dev)，日志: $BACKEND_LOG"
yarn dev > "$BACKEND_LOG" 2>&1 &
pids+=($!)

echo "启动前端 (frontend/ yarn dev)，日志: $FRONTEND_LOG"
(cd "$ROOT_DIR/frontend" && yarn dev) > "$FRONTEND_LOG" 2>&1 &
pids+=($!)

echo ""
echo "后端 PID: ${pids[0]}  前端 PID: ${pids[1]}"
echo "查看日志: tail -f $BACKEND_LOG   或   tail -f $FRONTEND_LOG"
echo "按 Ctrl+C 停止两个服务"

wait
