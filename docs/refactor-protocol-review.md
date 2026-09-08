# 评审：Plugin Refactoring Protocol（插件改造器）方向对不对

日期：2026-09-09 · 依据：DSH 源码与包文档（本机安装版）+ 本仓库实验 + GitHub Discussions #5106 / #5174 / #5237 原文

> 这份文档评审的是"能不能让工具去改造别人的插件、把原语收敛成语义操作"这个方向。
> 它和 `constraint-restrict-vs-nested-dispatch.md` 是同一件事的两面：那份说明**运行时收窄不可能**，
> 这份说明**源头收窄可行，但要用另一套机制**。

---

## 一、总判断

**方向对，而且比"运行时收窄"更值得做。但方案里有一处关键事实错误，必须先改掉。**

对的部分：

- **改源头，而不是改运行时视野** —— 这是唯一能真正减少 model-facing surface 的路径，本仓库实验已经证明了另一条路走不通；
- **三段职责划分**（程序做确定性、模型做语义判断、人做采用决定）—— 和 DSH 自己的设计姿态一致；
- **两个风险都真实存在**（语义误判、目标插件可能是当前宿主的一部分），而且社区已经各自撞过。

需要改的部分：

> **DSH 的 `cordis_define(kind: "existing")` / `cordis_update` 不能用来改造已安装的社区插件。**
> 它作用于**动态 Cordis 插件**——当前会话进程内存里的临时插件，不是 profile 里安装的包。

---

## 二、事实纠正：动态插件 ≠ 已安装插件

这是整份方案里最需要纠正的一处。两条线在 DSH 里是**两套完全不同的机制**：

| | 动态 Cordis 插件（`cordis_*` 工具） | 已安装插件（profile bundle） |
| --- | --- | --- |
| 身份 | `pluginId` + 不可变 `packageId`，会话内分配 | npm 包名 + 版本，写在 profile 的 `package.json` / `bundles` |
| 生命周期 | **进程内存，会话作用域**；DSH 重启即消失，不落盘 | 落盘，每次 boot 由 loader 加载 |
| 修改方式 | `cordis_define(kind:"existing")` 追加新 Package → `cordis_run(mode:"update")` | 改源码 / 重打包 / `dsh plugin add` / 重启 profile |
| 谁能看见 | **只有定义它的那个会话**，其他会话读作不存在 | 该 profile 的所有会话 |
| 代码运行环境 | `node:vm` 沙箱（`@deepseek-ai/dsh-cordis-host-runner`） | 正常 Node 进程 |

官方包文档的原话（`dsh-cordis-host-runner`）：

> "Definitions are session-scoped and process-local: a package is visible only to the session
> that defined it, other sessions read it as absent, and everything disappears on DSH restart.
> The session log keeps the define call's arguments — including the code it submitted — and the
> receipt; only the in-memory registry holds the parsed definition."

`cordis_inspect_self` 查的也是 `ctx.dynamicCordisRunner.inspectPlugin(agent, pluginId)`——
它只能看见**本会话的动态插件**。`@pluginId` 引用同样只指向动态插件。

**所以：**

- 想改造一个已安装的社区插件，你拿到的是它的**源码目录 / tgz**，不是 `pluginId`；
- "candidate package" 不可能是动态 Package，只能是**一个新的包版本（目录或 tgz）**；
- "promote" 不是 `cordis_update`，而是 `dsh plugin add` + 重启 profile。

**好消息**：沙箱里的 host half 可以拿到 `ctx.fs`（包文档明说 "Node globals are absent or
redirect to Cordis services (`ctx.fs`, `ctx.web`, `ctx.bash`, the timer helpers)"），
所以一个动态插件**能**读写磁盘、能生成候选目录。它只是不能"就地替换一个已安装插件"。

---

## 三、第二个机制差异：candidate + promote 在持久面更难

动态面的 `candidate → 人工批准 → promote` 之所以干净，是因为动态面自带：

```text
currentPackageId / nextPackageId
不可变 Package
失败不覆盖 current
一条指令回滚
```

**已安装插件没有这些。** profile 面只有：

```text
node_modules/<pkg>   ← 当前版本
（没有 next、没有多版本并存、没有一键回滚）
```

更糟的是故障不是局部的。社区实测（本机 `gh` 拉取的 Discussion 原文）：

- **#5106**（`ybkin1`，2026-08-30）：一个插件在加载期抛 `ReferenceError`，
  **整棵 plugin tree 都没起来**；恢复靠手动卸载/修复那一个插件，没有单插件禁用开关。
- **#5237**：从 `0.1.1-rc.2` 升级后 `dsh web` 直接起不来，错误是 `dsh-market`、
  `vision-toolkit` 等插件 import 了 `@deepseek-ai/dsh-settings` 已不存在的导出——
  **一个坏插件 = 整个 profile 不可用**，而且用户进不去界面自我修复。

**所以 promote 的设计必须比动态面保守：**

| 步骤 | 动态面 | 持久面（本方案） |
| --- | --- | --- |
| 试运行 | `cordis_run` 在沙箱里跑，失败不覆盖 current | **必须在隔离 profile / 隔离 DSH_HOME 里 boot 验证**（`--dump-config` 只验组合，不验激活） |
| 生效 | 原子切换版本指针 | `dsh plugin add` 覆盖安装 |
| 回滚 | `cordis_run(currentPackageId)` | 重新装回旧 tgz（前提：**动手前先备份旧包**） |

**硬性结论：改造器自己不能运行在被改造的 profile 里。** 它必须：

1. 在**另一个 profile / 另一个 DSH_HOME** 里做隔离验证；
2. 永远先备份目标包（`node_modules/<pkg>` 或原 tgz）；
3. 把"目标插件是否支撑当前宿主"作为**前置闸门**——这正好就是 #5174 里提的那条事实
   （"当前 profile / preset / plugin 是否正在支撑当前 Harness"）。

---

## 四、协议骨架（基于以上修正）

```text
inspect   读目标插件（目录/tgz）→ 工具注册清单 + 契约 + 依赖
analyze   静态分类：哪些是 model-facing 操作、哪些像 implementation primitive
propose   生成候选 capability 声明（人可读的 diff + 语义判断请求）
build     生成候选包目录（不覆盖原件）
verify    在隔离 profile 里 boot 验证（组合 + 激活 + 工具清单）
promote   人确认后安装到目标 profile（含备份 + 回滚命令）
```

三条边界（建议写进协议）：

1. **零自动 promote**：`verify` 通过也只是给出命令，不替人执行；
2. **语义由人确认**：静态分析只能给"看起来像原语"的候选，不能断言"这个工具没用"；
3. **宿主依赖是硬闸门**：目标是当前 profile 的一部分时，只允许生成候选，禁止 promote。

### 归属：这应该是 Maker 的第七个动作，不是新插件

用户已有的 `dsh-plugin-maker` 已经覆盖 `scaffold / check / vet / adopt / impact / upstream`，
其中 `adopt` 就是"少量安全、确定性的修改直接自动应用"。**Refactor 是 adopt 的语义级版本**：

```text
adopt    : 机械修改（路径、导出名、配置键）
refactor : 语义重构（N 个原语 → M 个 operation）
```

放在 Maker 里的好处：复用 `check`（契约规则）、`impact`（引用关系）、`upstream`（盯 DSH 变化），
以及它已经形成的"先声明影响范围，再验证"的纪律。做成独立插件会重复一半。

---

## 五、和 Capability Facade 的关系（重要）

两者不是替代，是**上下游**：

```text
Capability Facade   ← 改造后的目标形态（作者怎么写出窄工具面）
        ▲
        │  refactor 生成的就是这个
        │
Plugin Refactoring  ← 把已有插件迁移到那个形态
```

也就是说：**refactor 的产物应该正好是一段 `ctx.capabilities.register({...})` 声明**。
Facade 已经把"窄工具面"的语义固定下来了，refactor 只需要生成这个声明 + 对应的包改动。
这也是为什么本仓库要先把 facade 的语义和约束钉死——不然 refactor 没有目标格式。

---

## 六、风险再确认（同意用户的判断，补两点）

用户已经指出两条，都成立：

1. **语义误判**：`toolA` 可能是给高级用户单独调用的、`toolB` 是调试接口，收敛会毁掉作者的自由度。
   → 协议只能提"候选"，不能自动采用。这一点用户说对了。
2. **目标插件可能是当前宿主的一部分**：改它 = 可能把自己所在环境打死（#5174 明确要求 runtime
   暴露这个事实）。

补充两点：

3. **加载期故障是全局的**（#5106 / #5237 实证）：任何 promote 之前必须有隔离验证 + 备份 + 回滚命令。
4. **工具面变化会打 KV 前缀**：facade 的 schema 变更会让下一次请求的前缀复用失效
   （`dsh-tools` 文档："注册、dispose 或作用域限制可能从第一个改变的 schema token 起使复用失效"）。
   这不是不做，而是**要在提案里说明代价**，并尽量一次成型、避免反复改。

---

## 七、下一步（建议顺序）

1. **先做纯静态的 `analyze`**：只读插件目录，输出"工具清单 + 候选 capability 声明"，**零修改**。
   风险最低，而且立刻可用。
2. **再做 `verify` 的隔离 profile 脚手架**：把本仓库 `experiments/setup-profile.ps1` 的模式产品化
   （隔离 DSH_HOME + `--dump-config` + 一次 headless 冒烟）。
3. **最后才谈 `promote`**：且只给命令 + 备份 + 回滚，不自动执行。
4. **不做**：运行时隐藏、自动替换、按轮次动态增删。

---

## 八、一句话

> **"改源头而不是改视野"是对的；但源头不是动态 Package，是源码 + 打包 + 隔离验证 + 人工 promote。**
> 这件事应该长在 Maker 里，产出的正是 Capability Facade 的声明格式。
