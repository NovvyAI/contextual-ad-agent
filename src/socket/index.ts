import { Server } from "socket.io";

// M0 阶段还没有实现任何 Agent 的 Socket 会话（SessionAgent 等留给后续里程碑），
// 保留和 Toonflow 一致的"命名空间注册表"模式，后续往这个 routes 对象里加条目即可。
const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {};

export default (io: Server) => {
  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /api/socket/${name}`);
  }
};
