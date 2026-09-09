# dsh-capability-facade — 让插件作者写窄工具面

中文 | [English](./README.en.md)

> **DSH 的模型接口应该是"经过设计的、语义明确的 capability"，而不是一份工具清单。**
> 这个仓库提供一个 seam：作者声明一个 capability，它的每个 operation 变成一个模型可见工具，
> 内部按声明顺序、确定性地跑既有工具。

```text
实现工具                              模型可见面
pdf_extract ─┐
pdf_layout  ─┼── 声明的管线 ─────────▶  pdf_analyze
pdf_ocr     ─┘                          pdf_scan
```

它刻意**不是**工具管理器、不是 `call(toolName, args)` 万能入口、也不是治理层。
它是插件作者设计出来的接口里**面向模型的那一半**。

---

## 这个仓库首先记录了一个结论

社区插件常把内部操作直接注册成模型可见工具（一个插件 15 个操作 → 模型看到 15 个工具）。
最直觉的修法——"写个插件在运行时把多余的工具藏起来"——**行不通**：

> DSH 的工具注册表用**同一个** visibility resolver 决定 presentation、lookup 和 dispatch。
> 所以一个对模型隐藏的工具，对嵌套 dispatch 同样不可见。隐藏是"三合一"的。

也就是说，facade **无法收窄已经暴露出去的工具面**；它只能帮作者**一开始就写窄**。
实测证据在 [`experiments/REPORT.md`](experiments/REPORT.md)。

完整论证：[`docs/DESIGN-REVIEW.md`](docs/DESIGN-REVIEW.md) ·
那条约束与三条证据：[`docs/constraint-restrict-vs-nested-dispatch.md`](docs/constraint-restrict-vs-nested-dispatch.md)。

---

## 安装

```powershell
dsh plugin --profile <profile> add dsh-capability-facade-<version>.tgz
dsh --profile <profile> --dump-config   # 期望看到一行 dsh-capability-facade
```

**不声明任何 capability 时，这一行的 schema 增量、prompt 增量、代码路径增量都是 0。**
成本只在作者真的声明了东西的地方出现。

## 用法

插件读服务并声明 capability。步骤工具必须已经注册（facade 行放在工具插件之前，
或者 inject `capabilities` 稍后注册——注册是 fail-loud 的，顺序错了会直接报错，不会半注册）。

```js
export const inject = ['tools', 'capabilities']

export function apply(ctx) {
  // 实现工具：正常注册，照常受守卫/审批约束。
  ctx.tools.register(extractTool)
  ctx.tools.register(layoutTool)

  ctx.capabilities.register({
    id: 'pdf',                                   // → 工具名 pdf_*
    description: 'Read a PDF document: text, layout and OCR in one deterministic sequence.',
    operations: [
      {
        name: 'analyze',                          // → pdf_analyze
        description: 'Extract text and layout from a PDF in one call.',
        parameters: { path: { type: 'string', required: true } },
        steps: [
          { tool: 'pdf_extract' },                // 接收 operation 的入参
          { tool: 'pdf_layout', from: 'layout' }, // 接收入参里的 layout 字段
        ],
      },
    ],
  })
}
```

模型看到的 `pdf_analyze`：

```text
Extract text and layout from a PDF in one call.

[capability pdf] Read a PDF document: text, layout and OCR in one deterministic sequence.
Steps (run in this order by the harness, one call): 1. pdf_extract → 2. pdf_layout
```

一次模型调用跑完整条管线。每一步都是 `ctx.tools.execute()` 的**嵌套 dispatch**
（带 caller 的 agent 和 `parent: exec.token`），所以守卫、`tools/pre-execute`、审批、
around-dispatch 包装、post-execute、取消、结果物化**照常生效**。
facade 只加了名字和顺序，没有加权限。

### 返回结构

```json
{
  "ok": true,
  "capability": "pdf",
  "operation": "analyze",
  "steps": [
    { "tool": "pdf_extract", "ok": true, "text": "…", "value": { "pages": 2 } },
    { "tool": "pdf_layout",  "ok": true, "text": "…", "value": { "blocks": 7 } }
  ]
}
```

某一步失败会中止管线，并给出 `ok: false` / `failedStep` / `error` / 注册表的 `code`。
`from` 指向的字段缺失时同样失败，且**不会 dispatch**。
守卫拒绝会原样返回，模型读到的是策略理由，不是笼统的失败。

### API

| 成员 | 含义 |
| --- | --- |
| `register(capability, { scope?, agent? })` | 校验并给每个 operation 注册一个模型可见工具。全有或全无，返回精确的 disposer。 |
| `list()` | `[{ id, description, tools }]`，给诊断/设置页用。刻意不做成模型可见工具。 |

`scope` 让 operation 工具注册进某个 agent context（preset 的用法）；
`agent` 是步骤名解析所用的 scope key——步骤和 operation 在同一个 agent scope 时**必须**传，
因为一个 scope 自己的注册不属于它自己的视图。

`register()` 会拒绝：步骤工具不存在或被限制掉、capability id 重复、operation 工具重名、
description 为空、名字不匹配 `[a-z][a-z0-9_]*`。注册进去的东西在 dispose 和插件卸载时全部撤回。

---

## 它做不到的一件事

**facade 无法隐藏实现工具。**

DSH 的工具注册表用同一个 visibility resolver 喂 presentation、lookup 和 dispatch。
所以用 `ctx.tools.restrict()` 隐藏的工具，对嵌套 dispatch 也不可见——facade 自己的步骤会开始
报 `UNKNOWN_TOOL`。而注册在某个 scope 里的工具根本藏不掉：`restrict()` 只接受**继承层**
（全局/祖先）工具的名字。

这是实测结论，不是推测：

| 结论 | 怎么验的 |
| --- | --- |
| 被 restrict 的全局工具，嵌套 dispatch 也拿不到 | registry 测试 9、10 |
| `restrict()` 拒绝 scope 自己注册的名字 | registry 测试 10 |
| host 面注册者连 restriction 都装不上 | headless `hidden` 臂：`tools.restrict() requires a scoped context (agent.ctx)` |

所以 facade 的价值不是"比原来工具更少"，而是：

- **确定性顺序**——每步的顺序和入参由代码决定，不是模型的判断；
- **语义命名**——模型在"操作"之间选，而不是在"原语"之间选；
- **一次调用跑完**——1 次 root 调用 + N 次嵌套 dispatch，而不是 N 次 root 调用。

如果插件想让模型**只**看到语义面，作者就必须一开始不把实现工具注册成 model-facing。
这正是这个 facade 面向的写法。

---

## 证据

完整报告：[`experiments/REPORT.md`](experiments/REPORT.md)。

**registry 测试**（`npm test`）——49 条断言，跑在真实 `@deepseek-ai/dsh-tools` + 真实
Cordis context 上，覆盖注册契约、fail-loud 拒绝、schema 形态、管线执行、`from` 映射、
守卫仍然生效、失败语义、dispose、两条收窄约束、agent 作用域声明。

**headless 三臂实验**——真实 DSH profile（`dsh --profile facade-test "<task>"`），
每次 dispatch 写 JSONL 审计：

| 臂 | 模型看到的工具 | 模型实际做了什么 | 嵌套 dispatch |
| --- | --- | --- | --- |
| `raw` | `pdf_extract`、`pdf_layout` | 两次独立 root 调用 | 0 |
| `capability` | `pdf_analyze`（+ 两个原语） | 一次 `pdf_analyze` | 2 步，同一 root call |
| `hidden` | `pdf_analyze`（+ 两个原语） | 一次 `pdf_analyze` | 2 步；restriction 尝试被拒 |

`capability` 臂是机制成立：模型选了语义操作，harness 按声明顺序在**同一个 root call** 下
跑完两步。`hidden` 臂是边界成立：host 面注册者无法收窄 surface。

---

## 工具（重构协议的前两步）

本仓库还带了插件重构协议的**前两步**（设计见 [`docs/refactor-protocol-review.md`](docs/refactor-protocol-review.md)）：

### 1. `analyze` — 只读静态分析

```powershell
node scripts/analyze-plugin.mjs <plugin-dir>              # Markdown 报告
node scripts/analyze-plugin.mjs <plugin-dir> --json       # 机器可读
node scripts/analyze-plugin.mjs <plugin-dir> --propose    # 附一份起步声明
```

输出：插件注册了哪些模型可见工具、按前缀分组、哪些**看起来像**实现原语，
以及一条**提问**（不是建议）。它**只读**：测试里用目录快照证明它一个字节都不写。

它不做的事：不隐藏、不搬移、不改写任何工具，也从不宣称某个工具没用。
分组和分类都是启发式；"这两个工具是不是一个操作"是模型/人的判断。

### 2. `verify` — 隔离 profile 验证

```powershell
.\scripts\verify-plugin.ps1 -PluginDir <dir> -PluginName my-plugin           # 组合验证
.\scripts\verify-plugin.ps1 -PluginDir <dir> -PluginName my-plugin -Smoke    # 真启动一次
```

它在一个临时 profile（`verify-<random>`）里组合 `dsh-base + dsh-headless + 你的插件`，
先查组合（行是否解析、是否出现），`-Smoke` 时再真启动一次让 agent 回一个 `VERIFY-OK`。
**它不碰你的目标 profile**，结束后自动删除临时 profile。

为什么要真启动：`--dump-config` 只验证组合，不激活任何一行；而加载期抛错会拖死**整棵**
plugin tree（社区讨论 #5106 / #5237 都是这个现象）。实测：一个故意 `throw` 的插件
在组合阶段通过、在 boot 阶段被准确拦下。

### 3. 改写实验：我们自己的插件会变成什么样

`experiments/rewrite/` 在**不改任何插件源码**的前提下，对两个自研插件声明 capability 面并测量差异：

| 插件 | 原工具 | 声明的操作 | 结果 |
| --- | --- | --- | --- |
| `dsh-plugin-maker` | 6 | `maker_check` = check → vet | 6 + 1；一次调用给出"合规 + 每项改法" |
| `dsh-trajectory-tools` | 4 | `trajectory_locate` = find → window | 4 + 1；定位 + 取原文窗口一次完成 |

```powershell
node --import ./test/loader.mjs experiments/rewrite/test.mjs    # 14 项 → OK
```

结论（详见 [`experiments/rewrite/REPORT.md`](experiments/rewrite/REPORT.md)）：
**只有真的能合起来回答同一个问题的工具才值得声明成一个操作**——maker 的 6 个工具只合出 1 个；
硬凑会因参数形状不同而更难用。而且 facade 只加"更好的入口"，不减原语数量。

### 4. A/B：真实插件上模型行为变了什么

`experiments/ab-make/` 用同一个任务、同一份真实 `dsh-plugin-maker`，跑两个一次性 profile：

| 臂 | 模型可见的 maker 工具 | 根调用（模型轮次） | 结果 |
| --- | --- | --- | --- |
| `ab-raw` | 6 个原语 | **2**（check、vet 各一次） | 结论正确 |
| `ab-cap` | 6 个原语 + `maker_check` | **1**（facade 在一次调用内按序跑完两步） | 同一结论 |

审计插件监听 `tools/result`（嵌套调用也会触发），逐次记录 `tool / nested / rootCallId`。

```powershell
pwsh -File experiments/ab-make/ab-make.ps1
```

**结论**：capability 把"两次模型往返"压成"一次"，但**工具数没有下降**（6 → 7），
正确性也不变——它换掉的是"谁负责编排"，不是"模型更聪明"。
报告（含 N=1 与编排路径不稳定的诚实标注）：[`experiments/ab-make/REPORT.md`](experiments/ab-make/REPORT.md)。

### 5. A/B：真正收窄（6 → 1）改变了什么

`experiments/ab-narrow/` 让一个插件**只注册一个** `maker_check`（内部直接调用 maker 的纯函数），
与 maker 现状（6 个工具）对比：

| 任务 | an-wide（6 个工具） | an-narrow（1 个工具） |
| --- | --- | --- |
| 严格任务（只调一次、别做别的） | 1 次调用 | **1 次调用** |
| 宽松任务（检查并说清要修什么） | 2 次调用 | 26 次（调完 `maker_check` 后用 pwsh/read/grep 自己深挖） |

**结论**：surface 变小**不等于**调用变少；严格任务下两臂同为 1 次。
收窄省掉的是"在 6 个名字里选哪个、按什么顺序组合"的**认知成本**，不是工作成本。
报告：[`experiments/ab-narrow/REPORT.md`](experiments/ab-narrow/REPORT.md)。

### 6. 规模实验：157 个底层工具下的 Raw / ToolSearch / Facade

前几组实验都在 6 个工具的世界里，社区的真实规模是 178–1000 个工具（#2588 / #2137）。
`experiments/scale/` 构造了一个 157 工具的真实规格池，三臂对照：

| 臂 | 可见工具 | schema 字节 | 完成任务调用 | 根调用 |
| --- | ---: | ---: | ---: | ---: |
| `raw` | **182** | 54,310 | 2 | 2 |
| `search`（search→call） | **27** | 26,680 | 4 | 4 |
| `facade`（15 个语义操作） | **40** | 31,040 | 2 | 2 |

**结论**：ToolSearch 与 Facade **解决不同问题**——前者适合"能力空间巨大、关系不确定"，
用每轮多一次往返换掉 51% 的 schema；后者适合"内部关系稳定、重复组合明显"，
在不增加往返的前提下省 43% 的 schema。两者可叠加（先由作者组合，再由 search 管理长尾）。
报告：[`experiments/scale/REPORT.md`](experiments/scale/REPORT.md)。

### 7. 多任务实验：哪些操作边界能守住

同一组 15 个语义操作，跑 5 个任务（页数 / 另一资源页数 / 标题 / 日志错误数 / diverged 仓库）：

| 任务 | raw | search | facade |
| --- | ---: | ---: | ---: |
| T1 常规页数（操作覆盖） | 1 | 12 | **3** |
| T2 另一资源页数（操作覆盖） | 4 | 23 | **1** |
| T3 标题（操作不覆盖） | 48 | 25 | 10 |
| T4 日志 ERROR（无对应操作） | 8 | 11 | 10 |
| T5 diverged 仓库（修好参数接线后） | 34 | 138 | **1** |

**结论**：facade 的边界不由任务难度决定，而由**"任务是否需要作者没预见的参数/资源"**决定。
操作覆盖任务时一次调用搞定；不覆盖时它退化成探索，而且比 raw 更糟（连原语都看不见）。
报告（含一条作者最易犯的接线错：**声明了参数 ≠ 参数会流到步骤**）：
[`experiments/scale/MULTI-TASK-REPORT.md`](experiments/scale/MULTI-TASK-REPORT.md)。

### 8. 出口实验：不覆盖时能退出吗

给 facade 臂加一个逃生口（`pool_primitive`，按名调用任意原语），与"封闭世界"对照：

| 任务 | 封闭臂 | 有出口臂 |
| --- | --- | --- |
| T3 标题（操作不覆盖） | 32 次且**答错**（另两次 37/70 次蒙对） | 47–220 次，**总是答对** |
| T4 日志 ERROR | **1 次**（`cloud_inspect` 恰好返回了日志载荷） | 2–4 次 |
| T5 覆盖任务 | 4 次 | **2 次** |

**结论**：出口把"无解"变成"有解"，但**模型不会自动用它**——它先挨个试 15 个操作，很晚才想到出口。
另一个反直觉发现：T4 说明"操作不覆盖"是**作者的假设、不是事实**（按名字判断覆盖会判错）。
报告：[`experiments/scale/EXIT-REPORT.md`](experiments/scale/EXIT-REPORT.md)。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `lib/index.js` | 插件本体（host-only，无运行时依赖）。 |
| `lib/analyze.mjs` | 只读静态分析器（识别 `defineTool({...})` 与"包装函数 + spec 对象"两种注册形态）。 |
| `cordis.patch.yml` | profile 挂载的 bundle 行。 |
| `test/harness.mjs` | 49 条断言，跑在真实注册表上。 |
| `test/analyze.test.mjs` | 分析器测试（含"一个字节都不写"的证明与两种注册形态的回归）。 |
| `test/loader.mjs` | 仅本工作区用的解析垫片，不随包发布。 |
| `scripts/analyze-plugin.mjs` | `analyze` 的 CLI。 |
| `scripts/verify-plugin.ps1` | `verify` 的隔离验证脚本。 |
| `docs/` | 设计评审、约束证据、重构协议评审。 |
| `experiments/` | 三臂实验 + `rewrite/` 改写实验 + `ab-make/` 与 `ab-narrow/` 两组 A/B（脚本 / 审计日志 / 报告）。 |

## 复现

```powershell
# registry 级（不需要 DSH 进程）
npm test                                    # 49 项 → OK
node test/analyze.test.mjs                  # 23 项 → OK
node --import ./test/loader.mjs experiments/rewrite/test.mjs   # 14 项 → OK

# 分析器（只读）
node scripts/analyze-plugin.mjs <plugin-dir> --propose

# 隔离验证
.\scripts\verify-plugin.ps1 -PluginDir . -PluginName dsh-capability-facade -Smoke

# 真机三臂
& .\experiments\setup-profile.ps1
$env:FACADE_ARM='raw';        dsh --profile facade-test "<task>"
$env:FACADE_ARM='capability'; dsh --profile facade-test "<task>"
$env:FACADE_ARM='hidden';     dsh --profile facade-test "<task>"
```

## 设计边界

- **不是 dispatcher。** 没有 `use_capability(capability, operation, input)`。每个 operation 都是
  有名字、有描述、有类型的工具。万能 `call()` 只是把"模型排不出序的很多工具"换成"模型读不懂的
  一个黑箱"。
- **只做显式声明。** 不从工具名或元数据推导。capability 由知道"哪些原语该在一起、按什么顺序"的
  作者声明。
- **不引入新状态。** 没有 session、没有存储、没有定时器。注册是一次函数调用，销毁用注册表自己的
  disposer。
- **不洗白权威。** 步骤走正常管线，守卫、审批、沙箱、超时都按直呼时一样生效。
- **不用时零成本。** 不声明 capability → 没有 schema、没有 prompt 文本、没有代码路径。

## License

MIT — 见 [`LICENSE`](LICENSE)。
