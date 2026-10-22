# 第 2 天 · Cordis 插件模型

> **本日目标**：理解"注册即副作用、卸载即回滚"这条底层规则，并能徒手写出插件、服务、事件监听器。
> Cordis 是 DSH 的地基。这一天没打牢，后面每一天你都会在半懂半猜。

---

## 一、核心概念

### 2.1 插件就是一个函数

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // 在这里注册能力
}
```

没有基类，没有生命周期方法。框架调用 `apply`，把 `ctx` 给你，你往里挂东西。

**关键问题**：这些东西挂上去之后，怎么撤下来？答案是——**你不用管，框架管**。

### 2.2 Fiber：每个插件实例的独立生命周期

每个被加载的插件都拥有一个 **Fiber** 作用域：

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED

ACTIVE → UNLOADING → DISPOSED
```

| 状态 | 含义 |
|---|---|
| PENDING | 已声明，但依赖的服务还没就绪 |
| LOADING | 依赖就绪，`apply` 正在执行 |
| ACTIVE | 正在运行 |
| FAILED | `apply` 抛错 |
| UNLOADING | 正在卸载并释放资源 |
| DISPOSED | 完全卸载 |

这张表解释了一件重要的事：**插件的加载时机不是配置顺序决定的，是依赖决定的**。所以 `cordis.yml` 里行的顺序"不携带加载语义"——`base/cordis.patch.yml` 顶部那条注释说的就是这件事。

### 2.3 inject：依赖驱动的加载

```ts
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // 到这里，ctx.tools 和 ctx.llm 一定可用
}
```

规则比"启动时检查一次"强得多：

- 依赖缺失 → 停在 PENDING，不执行 `apply`。
- 依赖消失（比如 provider 被替换）→ 自动卸载，变 DISPOSED。
- 依赖回来 → 重新加载。

这就是为什么 DSH 换一个模型适配器不需要重启：老适配器消失，依赖它的插件自动卸载；新适配器就绪，它们自动重挂。

### 2.4 ctx.effect：可逆副作用

```ts
export function apply(ctx: Context) {
  // 事件监听、工具注册、定时器，全部自动清理
  ctx.on('some-event', handler)

  // 自己创建的资源，用一个 disposer 交还给框架
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

**卸载时的顺序**：disposer 按注册的逆序开始执行，但多个异步 disposer 并发执行，**没有串行完成保证**。

这条细节非常重要。如果你有"A 必须先于 B 关闭"的需求，正确写法是把它们放进**同一个** `ctx.effect()` 返回的 disposer 里，在里面串行 await。分开注册两个 effect 是错的。

### 2.5 Service：往 ctx 上挂一个能力

服务是"命名 + 类型 + 生命周期"三者的结合：

```ts
import { Service } from '@deepseek-ai/cordis'

export class MyService extends Service {
  constructor(ctx: Context) { super(ctx, 'myService') }
  doThing() { /* ... */ }
}

// 类型通过声明合并补上
declare module '@deepseek-ai/cordis' {
  interface Context {
    myService: MyService
  }
}
```

声明合并（declaration merging）在这里出现，是你在 DSH 里会反复见到的模式：`ctx.tools`、`ctx.sessions`、`SessionEventMap` 全是这么来的。**它不产生任何运行时代码，只是让 TypeScript 知道有这么个属性。**

### 2.6 waterfall：会短路的事件链

Cordis 有两种事件：

- **broadcast**：所有监听器都跑，谁也别想阻止谁。
- **waterfall**：监听器按顺序串起来，必须显式调用 `next()` 才把控制权交给下一个。

```ts
ctx.on('agent/pre-step', async (payload, next) => {
  if (shouldBlock(payload)) return { kind: 'reject', reason: '...' }
  return next()        // 忘了这行 = 静默短路整条链
})
```

**这是本仓库最高频的 bug 来源。** 一个忘记 `next()` 的监听器会让后面所有插件失效，而且不报错、不警告。

判断该用哪种：**需要"决定"或"改写"的用 waterfall；只需要"知道发生了"的用 broadcast。**

---

## 二、代码坐标

| 位置 | 看什么 |
|---|---|
| `../vendor/cordis/` | 框架源码本身，量不大，可以扫 |
| `../docs/cordis-primer.md` | 概念浓缩版，出门前必读 |
| `../docs/cordis-tutorial/01-first-plugin.md` ~ `07-into-the-harness.md` | 今天的主线，逐章动手 |
| `../docs/cordis-api/fiber.md`、`context.md`、`service.md`、`events.md` | 生成的 API 参考，查签名用 |
| `../packages/core/agent/src/runtime-types.ts:320` | 一个真实 waterfall 的类型声明（`agent/pre-step`） |
| `../packages/core/agent/src/runtime-types.ts:337` | `agent/request` waterfall 声明 |

看 `runtime-types.ts` 那几行时注意 `next: () => Promise<...>` 这个签名——它把"必须调用 next"写进了类型里。

---

## 三、精读片段

`../packages/core/agent/src/runtime-types.ts:320` 附近：

```ts
'agent/pre-step'(
  this: Scoped<Agent>,
  payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision>
```

这段类型声明的信息量很大：

1. **`this: Scoped<Agent>`** —— 这个事件的监听器可以被"作用域过滤"，只对某个 agent 生效。第 4 天会讲 scope。
2. **`payload.messages` 是可变意图** —— 监听器可以改写这批待进入的消息。
3. **`next` 返回 `PreStepDecision`** —— 链的最终产物是一个"决定"，而不是副作用。

对比一个 broadcast 事件，比如 `agent/status`：

```ts
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

返回 `void`，没有 `next`。**看签名就能判断这个事件能不能被拦截。**

---

## 四、动手

### 4.1 跑完教程七章

在仓库根：

```powershell
mkdir tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

每一章都从该目录运行：

```powershell
node --import tsx ../../vendor/cordis/bin.js
```

不要只看，**每章的 `cordis.yml` 和 `.ts` 都自己敲一遍**。

### 4.2 三个必做小练习

1. **一个带 effect 的插件**：注册一个 `setInterval`，用 `ctx.effect()` 返回清理函数。验证：卸载后定时器真的停了（打印日志确认）。
2. **一个服务 + 一个消费者**：A 插件提供 `ctx.greeter`，B 插件 `inject: ['greeter']` 使用它。验证：先只加载 B，它会停在 PENDING；再加载 A，B 才跑起来。
3. **一个 waterfall 短路**：写两个监听同一事件的插件，第一个不调 `next()`，验证第二个不执行。**然后再把 `next()` 加回去**，体会差异。

### 4.3 回到真实仓库验证

打开 `../packages/core/agent-loop/src/index.ts`，找到它的 `inject` 声明（如果没有显式 `inject`，看它 `apply` 里用了哪些 `ctx.xxx`）。列出它依赖的服务清单。

---

## 五、验收

1. 一个插件从声明到 DISPOSED，中间经过哪几个状态？谁触发状态迁移？
2. `inject` 和"在 apply 里检查服务是否存在"有什么本质区别？
3. 两个异步 disposer 并发执行会带来什么问题？正确写法是什么？
4. 不看代码，说出 waterfall 监听器忘记 `next()` 的后果，以及为什么它难查。
5. 声明合并在这套系统里解决了什么问题？它会产生运行时开销吗？

---

## 六、常见误解

**"插件是按 `cordis.yml` 里的顺序加载的。"**
不是。加载由服务可用性驱动，顺序不携带语义。你不知道为什么某个插件没起来时，先查它的依赖，不要查行序。

**"`ctx.effect()` 里的代码会在插件可用的每一刻重复执行。"**
不会。`apply` 执行一次，`ctx.effect` 注册一次清理函数。要重复执行的是定时器/监听器，不是 effect 本身。

**"waterfall 就是 middleware，差不多。"**
形似而神不同：middleware 通常有明确的"请求/响应"两端，waterfall 的产物是**一个决定值**，而且可以被任意一层完整替换。写的时候要想着"我这一层返回什么"，而不是"我下一个调用谁"。

---

## 七、延伸阅读

- `../docs/cordis-primer.md#cordis-waterfall-semantics` —— 短，但必须读
- `../docs/user/develop/framework/index.md` —— 生命周期状态机的官方版描述
- `../docs/postmortem/0001-acp-default-export-drops-inject.md` —— 一个真实事故：默认导出写错导致 `inject` 被丢弃。读完你会记住这条规矩

---

**明日预告**：明天离开地基，进入内核第一站——模型层。你会看到"模型返回的从来不是一段字符串，而是一串带类型的 chunk"，以及为什么这个设计决定了工具调用、思考过程、断流恢复能不能做对。
