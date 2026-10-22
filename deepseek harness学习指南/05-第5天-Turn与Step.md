# 第 5 天 · Turn 与 Step

> **本日目标**：把"一次用户输入到 agent 停下"这件事，拆成你能逐帧复述的状态机。
> 这是全书技术含量最高的一天。读懂了它，后面所有章节都只是它的注脚。

---

## 一、核心概念

### 5.1 两个词的严格定义

| 词 | 定义 | 数量关系 |
|---|---|---|
| **step** | 一次模型请求 + 它引发的工具执行 | 一个 turn 里 0..N 个 |
| **turn** | 一次输入的完整消化：开启于第一条输入被认领，结束于"不再欠任何事" | 顺序发生 |

为什么 turn 可以是 0 个 step？因为输入可能被 `agent/pre-step` 直接拒绝，或者被改写成空——**认领了边界，但没有花掉一次模型调用**。

### 5.2 turn 的主循环

`../packages/core/agent-loop/src/agent.ts:298` 的 `turn()` 结构（简化）：

```
turn():
  append('turn/start', { turn })
  while true:
    decision = await preStep(target)          // waterfall: 认领 + 允许改写/拒绝
    if decision.kind === 'reject':            // 明确拒绝
        return blocked
    if step === 0 && decision.messages.empty: // 首批被清空
        return completed                       // 不花 step，但仍关 turn
    append('step/start', { turn, step })
    outcome = await step(decision)
    if 不再欠请求 && 没有新输入: break
  append('turn/end', { reason })
```

四个关键判断点：

1. **拒绝和"空"是两回事**。拒绝是策略说"不许做"；空是认领了但没东西可做。
2. **turn 边界先落盘，再决定要不要做题**。所以日志里可能出现"有 turn/start 和 turn/end，中间没有 step"。
3. **step 之后要重新判断**：工具是否欠了下一轮请求？排队里是否来了新输入？两个条件任一成立就继续。
4. **`max-tokens` 是粘性的**：一旦某一步撞了输出上限，后面正常完成的 step 不能把整个 turn 的结局降级（`agent.ts:338` 的注释专门说这件事）。

### 5.3 preStep：策略介入的唯一入口

`preStep()`（`agent.ts:267`）做三件事：

1. **组装**：prompt 段落 + 工具 schema（`ctx.systemPrompt`）。
2. **认领**：从 inbox 取出本 step 的输入（首次还包括一条排队的 prompt）。
3. **过 waterfall**：`agent/pre-step` —— 监听器可以改写这批消息，也可以返回 reject。

```ts
'agent/pre-step'(payload, next): Promise<PreStepDecision>
```

**这是"插件改变 agent 行为"最重要的入口。** 想加内容过滤、想做输入改写、想在特定条件下拒绝执行——都挂这里，不要动循环。

一个易错点：包装型监听器必须用 `{ ...decision, messages }` 保留原决定的其他字段（比如 `startsRequestSeries`），不能只返回 `{ messages }`。

### 5.4 step：一次模型调用的完整回合

`step()`（`agent.ts:400`）是一个 `while(true)` 的**尝试循环**——因为一次 step 可能重试。

每次尝试做这些事（顺序不能乱）：

```
prepareRequest()                 // waterfall: agent/request → prepareCall
refreshContext()                 // 刷新运行时上下文
reconcile system prompt          // 把渲染好的 prompt 同步成 system/message 节点
if 第一次尝试: 落 user/message    // 只落一次！
buildRequest()                   // header.config + deriveMessages() + header.tools
stream()                         // 走 llm/stream，吐 chunk
落 assistant/message 或 assistant/attempt
跑工具（见第 7 天）
```

**为什么用户消息只在第一次尝试落盘？**
因为重试会重跑整个 `while(true)`，如果每次都落一遍 `user/message`，模型历史里会出现重复的用户发言。

**为什么 system prompt 每次都要 reconcile？**
因为重试时 prompt 可能变了（比如压缩插件改写了历史），需要把差异同步成新的事件。协调逻辑很细，见 `agent.ts:416-424`。

### 5.5 请求到底是什么

一条反直觉但很重要的事实（来自 `agent-loop/README.md`）：

> The request is `header.config`, `deriveMessages()`, and `header.tools`; it carries no `system` field.

意思是：发给模型的请求里**没有独立的 system 字段**。system prompt 被当成历史里的 `system/message` 节点，和其他消息一起派生。

这解释了 DSH 的核心设计：**prompt 不是一个参数，是一段历史。** 所以它可以被压缩、被替换、被精确重放——如果它是个参数，这些全都做不到。

### 5.6 事件顺序总表

| 事件 | 域 | 何时 |
|---|---|---|
| `turn/start` | durable | turn 开启 |
| `agent/inbox/claimed` | live | 输入被认领 |
| `agent/pre-step` | waterfall | 认领后、进 step 前 |
| `step/start` | durable | step 开启 |
| `agent/request` | waterfall | 构造请求前 |
| `request/header` | durable | 路由/工具变化时 |
| `request/context` | durable | provider/model/窗口变化时 |
| `system/message` | durable | prompt 协调产生新节点时 |
| `user/message` | durable | 首次尝试时 |
| `llm/stream` | waterfall | 真正发请求 |
| `agent/assistant-stream` | live | 流式帧 |
| `assistant/message` / `assistant/attempt` | durable | 成功 / 失败结算 |
| `tool/call` → `tool/result` | durable | 工具执行 |
| `step/end` | durable | step 结束 |
| `agent/turn-stopping` | serial | turn 即将结束 |
| `turn/end` | durable | turn 结束 |

**durable 与 live 的分界线**，就是"这件事要不要在重启后还能重建"。

---

## 二、代码坐标

| 位置 | 看什么 |
|---|---|
| `../packages/core/agent-loop/src/agent.ts:267` | `preStep()`：组装 + 认领 + waterfall |
| `../packages/core/agent-loop/src/agent.ts:298` | `turn()`：主循环与四个判断点 |
| `../packages/core/agent-loop/src/agent.ts:400` | `step()`：尝试循环 |
| `../packages/core/agent-loop/src/agent.ts:564` | `prepareRequest()`：`agent/request` + `prepareCall` |
| `../packages/core/agent-loop/src/agent.ts:616` | `buildRequest()`：请求的最终形状 |
| `../packages/core/agent-loop/src/tool-calls.ts` | 工具调度：独占屏障 + 有界并行池 |
| `../packages/core/agent-loop/src/runtime-context.ts` | 每 step 的运行时上下文快照 |
| `../packages/core/agent/src/runtime-types.ts:320` | `agent/pre-step` 的类型 |
| `../docs/architecture.md:83-116` | turn flow 的官方文字版 |
| `../docs/agent-lifecycle.md` | 同一件事的时序图 |

---

## 三、精读片段

`../packages/core/agent-loop/src/agent.ts:315-332`：

```ts
while (true) {
  signal.throwIfAborted()
  const step = phase.step + 1
  const decision = await this.preStep(target, { turn, step })
  if (decision.kind === 'reject') {
    turnEnds = { kind: 'blocked' }
    return false
  }
  if (turnEnds && decision.messages.length === 0) break
  if (phase.step === 0 && decision.messages.length === 0) {
    turnEnds = { kind: 'completed' }
    return false
  }
  signal.throwIfAborted()
  this.session.append('step/start', { turn, step })
  ...
}
```

逐行看：

- `signal.throwIfAborted()` 出现两次——**每个 await 前后都要检查取消**。异步边界是取消语义最容易漏的地方。
- `if (turnEnds && decision.messages.length === 0) break`：如果这个 turn 已经有过 step，且这一轮没认领到东西，就正常结束。
- `if (phase.step === 0 && decision.messages.length === 0) return false`：**首批为空**开销掉 turn 边界，但不产生 step。

这两行合起来，就是"turn 可以有零个 step"的全部实现。

---

## 四、动手

### 4.1 打开日志对照

跑一段真实对话，然后打开它的 `session.jsonl`，**逐行标注**每个事件属于上面哪一步。重点确认：

- `step/start` 之前有没有 `user/message`？（应该没有——它在 step 内部才落）
- 一次工具调用产生了几个 step？
- `request/header` 是每个 step 都有，还是只在变化时出现？

### 4.2 挂一个监听器观察

写一个插件，监听 `agent/pre-step` 并打印收到的消息数，然后 `return next()`。观察每一步进来几条。

**然后做一次对照实验**：故意不调 `next()`，看会发生什么。你会亲眼看到"静默短路"。

### 4.3 画图

合上书，白纸上画出从 `followup()` 到 `turn/end` 的完整序列，标出：

- 哪些是 waterfall（有三个）
- 哪些事件是 durable
- `assistant/message` 之前必须已经有什么

---

## 五、验收

1. 一个 turn 为什么可以有 0 个 step？代码里哪两行实现了它？
2. `preStep` 做了哪三件事？为什么"认领"和"组装"要在同一个函数里？
3. 用户消息为什么只在第一次尝试落盘？多落一次会怎样？
4. 请求里为什么没有 `system` 字段？这个设计换来了什么能力？
5. `max-tokens` 为什么必须"粘性"？

---

## 六、常见误解

**"turn 就是一个用户消息触发的。 "**
不完全是。turn 还可能是 goal 轮、定时任务、子 agent 回报触发的。用户消息只是最常见的唤醒源。

**"重试就是重新发一次请求。"**
不是。重试在**同一个 step 内**重跑，会重新 `prepareRequest`、重新协调 prompt，但**不重复 `agent/pre-step`，也不重复用户消息落盘**。

**"prompt 是请求的一个参数。"**
在 DSH 里它是历史里的节点。这个区别决定了压缩、替换、重放能不能成立。

---

## 七、延伸阅读

- `../docs/agent-lifecycle.md` —— mermaid 时序图，用 VSCode 预览渲染后对照读
- `../packages/core/agent-loop/README.md` —— "Turn and step flow" 一节的权威描述
- `../docs/subsystems/core.md#the-agent-handle` —— 取消与错误恢复

---

**明日预告**：今天你看到大量 `session.append(...)`。明天进入日志本身：为什么它是 append-only、`surfaceOp` 是什么意思、`deriveMessages()` 凭什么保证"模型看到的"和"记录下来的"一致。
