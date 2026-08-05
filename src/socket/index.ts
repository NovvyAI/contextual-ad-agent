import { Server } from "socket.io";
import sessionAgent from "./routes/sessionAgent";
import monitor from "./routes/monitor";

const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = { sessionAgent, monitor };

export default (io: Server) => {
  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /api/socket/${name}`);
  }
};
