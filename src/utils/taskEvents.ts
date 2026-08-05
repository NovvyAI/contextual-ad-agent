import { EventEmitter } from "node:events";

/**
 * 全局任务事件总线——taskRecord.ts 是被到处调用的底层工具函数，不适合直接在里面碰 Socket 实例，
 * 用这个 EventEmitter 中转：taskRecord 只管 emit，谁想听（会话页面的 socket、独立监控页面的 socket）
 * 自己订阅，两边互不知道对方存在。
 */
export interface TaskStartEvent {
  id: number;
  projectId: number;
  taskClass: string;
  stage: string;
  describe: string;
  relatedObjects?: string;
  model: string;
  input?: string;
  startTime: number;
}

export interface TaskDoneEvent {
  id: number;
  projectId: number;
  taskClass: string;
  state: 1 | -1;
  durationMs: number;
  reason?: string;
  output?: string;
}

class TaskEvents extends EventEmitter {
  emitStart(event: TaskStartEvent) {
    this.emit("task:start", event);
  }
  emitDone(event: TaskDoneEvent) {
    this.emit("task:done", event);
  }
  onStart(listener: (event: TaskStartEvent) => void) {
    this.on("task:start", listener);
    return () => this.off("task:start", listener);
  }
  onDone(listener: (event: TaskDoneEvent) => void) {
    this.on("task:done", listener);
    return () => this.off("task:done", listener);
  }
}

export default new TaskEvents();
