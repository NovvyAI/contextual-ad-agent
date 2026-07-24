import { Server } from "socket.io";
import sessionAgent from "./routes/sessionAgent";

const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = { sessionAgent };

export default (io: Server) => {
  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /api/socket/${name}`);
  }
};
