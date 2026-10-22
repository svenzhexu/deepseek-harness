# 第 4 天 · Agent 与循环

> **本日目标**：搞清楚 `ctx.agents` 这一层做了什么，以及 `followup` / `steer` / `inject` 三种投递方式为什么必须分开。

---

## 一、核心概念

### 4.1 两层：Agent 是接口，AgentLoop 是驱动

| 层 | 包 | `ctx` 键 | 职责 |
|---|---|---|---|
| 接口与注册表 | `packages/core/agent` | `ctx.agents` | 定义 `Agent` 契约、管理活的 agent、发 `agent/*` 事件 |
| 具体驱动 | `packages/core/agent-loop` | `ctx.agentLoop` | 真正实现"调模型 → 跑工具 → 再调"的循环 |

**为什么分开**：`ctx.agents` 是稳定的公共面，扩展插件依赖它；`agent-loop` 是可替换的实现。仓库明确规定"扩展插件依赖 Service Definition，绝不依赖具体 provider"。

所以你在业务代码里应该永远 `ctx.agents.create(...)`，而不是 `new ReactLoopAgent(...)`。

### 4.2 Agent 契约：它对外承诺什么

一个 `Agent` 暴露的核心能力：

| 成员 | 语义 |
|---|---|
| `session` | 它拥有的会话（可读日志、可派生消息） |
| `followup(msg)` | 排队，**开新的一轮** |
| `steer(msg)` | 插入当前轮，**下一 step 生效** |
| `inject(msg)` | 插入当前轮，但**不唤醒**驱动 |
| `cancel(cause, opts)` | 中止当前活动 |
| `whenIdle()` | 等待收敛 |
| `ctx` | 该 agent 的作用域上下文 |

### 4.3 三种投递方式的真正区别

看源码最直接（`../packages/core/agent-loop/src/agent.ts:163-173`）：

```ts
followup(input) { this.send(input, 'next-turn', true) }
steer(input)    { this.send(input, 'next-step', true) }
inject(input)   { this.send(input, 'next-step', false) }
```

三个参数分别决定：**进哪个队列**、**要不要唤醒驱动**。

| 方法 | 目标队列 | 唤醒 | 典型场景 |
|---|---|---|---|
| `followup` | `next-turn` | 是 | 用户发了新消息 |
| `steer` | `next-step` | 是 | 用户想中途纠正当前任务 |
| `inject` | `next-step` | 否 | 插件补充上下文，等模型下次自然醒来才带过去 |

**`inject` 不唤醒**这条最容易误解。它的语义是："这条信息放在这儿，等下一次有理由调模型时再带上。"如果你希望模型立刻反应，用 `steer`。

### 4.4 一个反直觉的细节：唤醒不能加入已中止的活动

`send()` 里有一行很微妙的逻辑（`agent.ts:157`）：

```ts
const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
```

含义：**如果当前活动已经中止，一条"唤醒型"消息不能塞进这个将死的一轮，必须升级成下一轮。**

而且注释说明了为什么要 `Captured before the insertion`——防止在 splice 观察者里重入 cancel 导致分类被改写。

这类细节是"读懂 harness"和"能改 harness"的分水岭。你不需要背下来，但要有能力在出问题时定位到它。

### 4.5 AgentHandle：谁负责关灯

`ctx.agents.create()` 返回 `AgentHandle`。**谁创建，谁负责 `dispose()`**。

- 创建过程是一个**带回滚的事务**：建 session → 建 agent → 建 scoped ctx → 可选 setup → 进注册表 → 宣告 `session/created` → 串行等 `agent/created` → 放行排队输入。
- 中间任一步失败，前面建的东西全部回滚。
- 已经送达的公告不会被"撤回"，但会收到匹配的 disposal 通知。

这条契约解释了为什么插件里创建 agent 必须用 `ctx.effect()` 管住 handle——否则你的插件卸载了，agent 还在跑。

### 4.6 Scope：注册可以只对一个 agent 生效

`agent.ctx` 是一个**作用域上下文**。通过它注册的东西（工具、prompt 段落、监听器）只对这个 agent 可见，并随它销毁。

两个事实要分清（见 `../docs/glossary.md` 的 `agent-scope` 一节）：

- **通过 `agent.ctx` 注册** → 效果是 scope 可见 + scope 生命周期。
- **事件的 scope 过滤** → 靠 dispatch 时传的 carrier，不是靠你在哪个 ctx 里注册。

这是最容易写错的地方之一。记住一句话：**注册看 ctx，分发看 carrier。**

---

## 二、代码坐标

| 位置 | 看什么 |
|---|---|
| `../packages/core/agent/src/index.ts:393` | `create()`：创建 agent 的唯一正门 |
| `../packages/core/agent/src/index.ts:412` | `resume()`：从持久化会话恢复 |
| `../packages/core/agent/src/index.ts:329` | `withInitiator()`：把操作归属到某个 agent |
| `../packages/core/agent-loop/src/agent.ts:98` | `ReactLoopAgent` 类声明 |
| `../packages/core/agent-loop/src/agent.ts:154-181` | `send` / 三种投递 / `cancel` |
| `../packages/core/agent-loop/src/agent.ts:237` | `whenIdle()` |
| `../packages/core/agent-loop/src/inbox.ts` | 收件箱：durable 投影 + 循环私有 claim 状态 |
| `../packages/core/agent/src/runtime-types.ts:261-393` | 全部 `agent/*` 事件声明 |

---

## 三、精读片段

`../packages/core/agent-loop/src/agent.ts:175`：

```ts
cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
  if (!options.keepInbox) {
    this.inbox.clear()
    if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
  }
  if (this.phase.kind !== 'idle') this.phase.abort.abort(cause)
}
```

三行代码，三个决定：

1. **默认清空收件箱**。取消的语义是"这件事我不做了"，不是"暂停"。要保留排队工作，显式传 `keepInbox`。
2. **`wakeRequested` 一起清掉**。否则取消后驱动还会被一个已经无效的唤醒叫起来，白跑一轮。
3. **只有非 idle 才 abort**。空闲时取消是无操作，不该产生副作用。

**这就是"防御式编程"在真实代码里的样子**：每个分支都在回答"如果不这样会怎样"。

---

## 四、动手

### 4.1 用 SDK 直接驱动一个 agent

不需要写插件，用 `ctx.agents.create()` 就能跑起来。参考 `../packages/sdk/client/README.md` 里的 `DeepSeekHarness` 用法，或者写一个最小插件，在 `apply` 里：

```ts
const handle = await ctx.agents.create({
  agentOptions: { provider: 'deepseek', model: 'deepseek-chat' },
  setup: (agentCtx, agent) => {
    // 在这里通过 agentCtx 注册只属于这个 agent 的东西
  },
})
ctx.effect(() => () => handle.dispose())
```

### 4.2 观察三种投递的差异

写一个小实验：

1. 让 agent 做一个长任务（比如"逐个读这 10 个文件并总结"）。
2. 在它跑到一半时，分别用 `steer` 和 `inject` 送一条消息，观察下一条模型请求里有没有这条消息。
3. 用 `followup` 送一条，观察它是等当前轮结束才被处理。

**这个实验比读十遍文档有用。**

### 4.3 找到所有 agent 事件

打开 `../packages/core/agent/src/runtime-types.ts`，把 261–393 行的事件名抄下来，标注每个是 broadcast 还是 waterfall（看有没有 `next` 参数）。

---

## 五、验收

1. `ctx.agents` 和 `ctx.agentLoop` 分别是什么？为什么不直接依赖后者？
2. `steer` 和 `inject` 都进 `next-step`，区别在哪？各自适合什么场景？
3. 为什么"唤醒型消息"在活动已中止时要升级成下一轮？
4. `AgentHandle` 的所有权规则是什么？不 dispose 会怎样？
5. "注册看 ctx，分发看 carrier"是什么意思？举一个会踩坑的例子。

---

## 六、常见误解

**"`followup` 就是发消息，`steer` 就是插队，`inject` 就是发消息但不显示。"**
不对。三者的区别是**队列位置 + 是否唤醒**这两个正交维度，跟 UI 显不显示没关系。

**"agent 创建好就自动归我管了，卸载时框架会收拾。"**
不会。`AgentHandle` 的所有权在你手上。插件里必须用 `ctx.effect()` 挂 disposer，否则插件卸载后 agent 还在跑，泄漏。

**"scope 就是命名空间。"**
不只是。它同时是**可见性边界**和**生命周期边界**，而且这两个事实由同一个 key 驱动。这个设计在 `../docs/glossary.md` 里叫 "one fact drives both"。

---

## 七、延伸阅读

- `../docs/subsystems/core.md` —— 核心子系统的完整参考
- `../packages/core/agent/README.md` —— `Agent` 契约的权威描述
- `../packages/core/agent-loop/README.md#understand-the-implementation` —— 创建与拆卸的事务细节

---

**明日预告**：今天你知道 agent 有哪三种投递方式，明天要拆开看——一条消息进来之后，到底怎么变成一个 turn、几个 step，中间经过哪些 waterfall，日志在什么时刻落盘。
