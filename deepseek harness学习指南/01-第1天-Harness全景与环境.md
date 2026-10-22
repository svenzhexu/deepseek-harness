# 第 1 天 · Harness 全景与环境

> **本日目标**：把"harness"这个词从抽象感觉变成一排能指认的部件，并且在你的机器上把它的插件树打印出来。

---

## 一、核心概念

### 1.1 Harness 到底是什么

模型只会"给一段文本、吐一段文本"。它在真实环境里做事需要外面套一层，这层固定干六件事：

| 职责 | 具体内容 | 不做会怎样 |
|---|---|---|
| **循环** | 反复调模型，直到它不再要求调工具 | 模型说"我要读文件"之后就没下文了 |
| **行动** | 把 tool_call 变成真实副作用 | 模型永远只能"说"，不能"做" |
| **上下文** | 决定每次请求塞什么给模型 | 要么撑爆窗口，要么模型失忆 |
| **记录** | 把发生过的事变成可重放的事实 | 断线重连、fork、审计全部失效 |
| **边界** | 沙箱、审批、超时、预算 | 一条 `rm -rf` 就能毁掉你的机器 |
| **接口** | 对外的 CLI / SDK / Web | 无法嵌进任何产品 |

**判断一个东西是不是 harness，就看它有没有把这六件事都做了。** 只做"循环 + 工具"的是玩具；六件全做才叫生产可用。

### 1.2 DeepSeek 的选择：连循环都是插件

大多数框架有一个核心 `while` 循环，插件只能挂在外面。DSH 不一样：**agent loop 本身就是一个插件**（`packages/core/agent-loop`），理论上可以被整体替换掉。

这条决定往下推，会产生一系列你必须适应的后果：

- 没有 `main()` 可以从头读到尾——启动路径是"读 profile → 叠 patch → 按服务可用性激活插件"。
- 看代码不能按目录平铺，必须按"能力边（seam）"三个角色一组读。
- 你想要的任何改动，**先问能不能用配置表达，再问要不要写代码**。

### 1.3 三个词：profile / bundle / patch

这是理解启动的第一组概念，第 10 天会展开，今天只需要建立直觉：

```
profile（一个具名组合，存在 Harness home 里）
  └── 按顺序叠 bundle（可分发的插件行集合）
        └── 每一层都可以被 patch 覆盖（按 row id 整行替换）
```

- `web` / `headless` / `sdk` / `sdk-minimal` / `acp` 是**模板**，不是代码。
- `dsh-base` 是前四个 profile 共享的第一层。
- patch 是**整行替换**，不是深合并——这条规则后面会坑你。

### 1.4 一次 turn 的表层现象

今天不要求懂内部，但要建立"一次交互长什么样"的观察习惯。你在 UI 里看到的一段对话，底下至少发生了：

```
用户输入 → 组装 prompt + 工具列表 → 调模型 → 模型要调工具
        → 执行工具 → 把结果记下来 → 再调模型 → … → 模型不再要工具 → 结束
```

这串东西有个正式名字：**turn 与 step**。第 5 天会逐帧拆开。

---

## 二、代码坐标

| 位置 | 看什么 |
|---|---|
| `README.md:5-9` | 项目自称是什么：everything-is-a-plugin，基于 Cordis |
| `../docs/architecture.md:1-39` | Cordis、profile/bundle 的权威描述，**今天只读这两节** |
| `../packages/bundle/base/cordis.patch.yml` | 共享底座的全部插件行，共 96 个 `- id:` |
| `../packages/bundle/base/package.json` | `dsh.bundle` 字段指向上面那个 patch 文件 |
| `../apps/cli/src/bin.ts`、`src/profile-boot.ts` | 真正的入口：`dsh` 命令怎么把 profile 变成一棵树 |
| `../docs/architecture.md:41-47` | "应用启动只能走命名 profile"这条硬规矩 |

> **为什么先看 `base/cordis.patch.yml`**：它是"这个产品由哪些东西组成"的唯一清单。读完它，你对 DSH 的想象会从模糊变成具体。

---

## 三、精读片段

打开 `../packages/bundle/base/cordis.patch.yml`，前 60 行是这样的结构：

```yaml
# A patch replaces the targeted row's whole `config` rather than merging into
# it, so a row whose value differs by mode does NOT live here...
- insert:
    - id: llm
      name: '@deepseek-ai/dsh-llm'

    - id: session
      name: '@deepseek-ai/dsh-session'

    - id: typert
      name: '@deepseek-ai/dsh-typert-registry'
    ...
```

三点值得注意：

1. **`id` 是稳定地址**。上层 patch 靠它定位，所以改 id 等于破坏兼容。
2. **`name` 是包名，不是路径**。运行时按模块解析找包，这也是为什么"Raw/Web 的 bare plugin 必须出现在 resolver manifest 的 dependencies 里"。
3. **`disabled: !!js "..."` 是条件加载**。比如 `plugin-manager` 只在有 `profileContext` 时启用——这就是"启动期按环境裁剪"。

再往下扫一遍所有 `- id:`，试着给它们分个类：哪些是**基础设施**（llm/session/tools/system-prompt）、哪些是**能力**（fs/shell/web/mcp）、哪些是**策略**（sandbox/approval/permission）、哪些是**产品功能**（goal/plan/skill/compaction）。

这个分类动作，就是你今天的产出。

---

## 四、动手

### 4.1 环境

```powershell
pnpm install
pnpm run typecheck        # 首次基线，通过才算环境 OK
pnpm run build
```

### 4.2 打印插件树

```powershell
pnpm dsh --profile web --dump-config > tmp/web-tree.txt
```

打开 `tmp/web-tree.txt`：

- 数一数有多少行。
- 找出 `llm`、`session`、`tools`、`agent-loop` 各在哪一行。
- 找出哪些行是 `disabled: true`，想想为什么。

### 4.3 观察一次真实任务

打开桌面客户端（或 `pnpm dsh web`），让它做一个需要多步的任务，比如：

> "读一下这个仓库的 package.json，告诉我它用了哪些测试命令，然后解释 `test:snapshot` 是干什么的。"

全程观察：

- 它调了几次工具？每次工具调用之间界面有没有"思考"态？
- 它有没有先规划再执行？
- 它在哪一步停下来等你？

**把观察记下来**，第 5 天你会用这份记录对照源码。

---

## 五、验收

合上书，回答这五个问题（答不上来就回去重读对应小节）：

1. Harness 的六项职责是什么？少一项会怎样？
2. 为什么 DSH 说"没有特权内核"？这对读代码的方式有什么影响？
3. profile、bundle、patch 三者的关系是什么？patch 为什么是"整行替换"而不是"深合并"？
4. `--dump-config` 打印出来的东西，和 `cordis.patch.yml` 是什么关系？
5. 你要改一个插件的配置，最小的改动是什么？（提示：不是改源码）

---

## 六、常见误解

**"我应该先把 `packages/` 通读一遍。"**
不要。340 个包，通读等于溺水。正确姿势是跟着能力边走——附录 A 有地图。

**"桌面客户端和源码是一回事。"**
不是。客户端跑的是 `app.asar` 里的打包副本。改源码对它零影响，验证一律用 `pnpm dsh web`。

**"`--dump-config` 只是调试用的。"**
它是你理解这个产品最重要的工具。任何时候你搞不清楚"到底装了什么"，就 dump 一次。

---

## 七、延伸阅读

- `../docs/architecture.md` —— 明天之后每天都会回来查
- `../docs/glossary.md` —— 术语卡表，建议今天就通读一遍（只有 46 行）
- `../packages/README.md` —— 包分组地图，第 10 天会用到

---

**明日预告**：明天进入 Cordis。你会亲手写出一个插件，并理解为什么"注册即副作用、卸载即回滚"这条规则，是整个 DSH 可组合性的地基。
