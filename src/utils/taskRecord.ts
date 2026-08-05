import db from "@/utils/db";
import taskEvents from "@/utils/taskEvents";
import { stageLabelForTaskClass } from "@/agents/shared/taskStageLabel";

const taskStateMap = {
  "0": "进行中",
  "1": "已完成",
  "-1": "生成失败",
};

function serialize(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "function") throw new Error("不支持的类型");
  try {
    return JSON.stringify(value);
  } catch (e) {
    return value.toString();
  }
}

/**
 * 记录任务并返回结束函数
 * @param projectId  项目 ID
 * @param taskClass  任务分类
 * @param modelName   模型名称
 * @param opts       可选项：关联对象、任务描述、大模型调用的输入（ai.ts 传进来的时候已经用
 *                   summarizeForLog 把图片/视频等二进制内容替换成简短描述，这里只管序列化落库）
 */
export default async function taskRecord(
  projectId: number,
  taskClass: string,
  modelName: string,
  opts: {
    describe?: string;
    content?: any;
    input?: any;
  } = {},
) {
  const { content, describe = "", input } = opts;
  const opteorContent = serialize(content);
  const inputText = serialize(input);

  const startTime = Date.now();
  const [id] = await db("o_tasks").insert({
    projectId,
    taskClass,
    relatedObjects: opteorContent,
    model: modelName,
    describe,
    input: inputText,
    state: taskStateMap[0],
    startTime,
  });
  taskEvents.emitStart({
    id,
    projectId,
    taskClass,
    stage: stageLabelForTaskClass(taskClass),
    describe,
    relatedObjects: opteorContent,
    model: modelName,
    input: inputText,
    startTime,
  });

  /** 任务成功时调用 done(1, undefined, output)，失败时调用 done(-1, '原因') */
  return async function done(state: 1 | -1, reason?: string, output?: any) {
    const durationMs = Date.now() - startTime;
    const outputText = serialize(output);
    await db("o_tasks")
      .where("id", id)
      .update({
        state: taskStateMap[state],
        durationMs,
        reason: state === -1 ? (reason ?? "") : null,
        output: outputText,
      });
    taskEvents.emitDone({ id, projectId, taskClass, state, durationMs, reason, output: outputText });
  };
}
