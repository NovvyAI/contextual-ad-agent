import { Socket } from "socket.io";
import u from "@/utils";

const PERSISTABLE_EVENTS = new Set(["message", "message:update", "content:add", "content:update"]);

/**
 * `resTool.ts` 里 MessageBuilder/ContentStream 等一堆类到处都是 `this.socket.emit(...)`，
 * 只用到 `emit` 这一个方法——与其在几十个调用点分别加持久化逻辑，不如在传进去的 socket 对象这一层
 * 统一拦截：给一个只实现 `emit` 的轻量包装对象（不用对整个 Socket 实例做 Proxy，`resTool.ts`
 * 用不到别的方法），把四类协议事件（message/message:update/content:add/content:update）先异步
 * 落库到 `ab_chatEvent`，再转发给真实 socket 触发实时推送。落库是 fire-and-forget（不 await），
 * 失败只打日志——不能因为这个影响实时消息投递。
 */
export function wrapSocketForPersistence(socket: Socket, episodeId: number, matchSessionId?: number): Socket {
  return {
    emit: (event: string, payload?: any) => {
      if (PERSISTABLE_EVENTS.has(event)) {
        u.db("ab_chatEvent")
          .insert({ episodeId, matchSessionId: matchSessionId ?? null, eventType: event, payload: JSON.stringify(payload), createTime: Date.now() })
          .catch((e) => console.error("[chatEvent persist] 写入失败:", u.error(e).message));
      }
      return socket.emit(event as any, payload);
    },
  } as Socket;
}
