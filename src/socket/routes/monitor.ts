import { Namespace, Socket } from "socket.io";
import taskEvents from "@/utils/taskEvents";

// 独立监控页面用的命名空间——和 sessionAgent.ts 那条不一样，这里不按 episodeId 过滤，
// 所有 episode 的 task:start/task:done 全量转发给每个连上来的监控页面客户端。
// 不做鉴权（内部工具，本机 dev 环境使用），和 sessionAgent 命名空间要求 token 不一样。
export default (nsp: Namespace) => {
  nsp.on("connection", (socket: Socket) => {
    console.log("[monitor] 已连接:", socket.id);

    const offStart = taskEvents.onStart((event) => socket.emit("task:start", event));
    const offDone = taskEvents.onDone((event) => socket.emit("task:done", event));

    socket.on("disconnect", () => {
      offStart();
      offDone();
      console.log("[monitor] 已断开连接:", socket.id);
    });
  });
};
