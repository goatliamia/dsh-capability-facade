# 实验报告：Capability Facade 是否成立

日期：2026-09-08/09 · 状态：机制已验证（registry 级 + 真机 headless）· 结论：**成立，但边界比设想窄**

---

## 0. 这次实验要回答什么

不是"要不要做插件治理"，而是三个可证伪的问题：

1. 一个**语义操作**（如 `pdf_analyze`）能不能在一个模型调用里、按声明顺序，跑完一串底层工具？
2. 跑这些底层步骤时，**守卫/审批/取消/结果契约**是否仍然生效——还是被 facade 绕过了？
3. facade 能不能**让底层工具不再出现在模型面前**（真正收窄 surface）？

---

## 1. 方法

### 1.1 Registry 级（真机库，非 mock）

`test/harness.mjs` 在真实 `@deepseek-ai/cordis` Context 上挂载真实
`@deepseek-ai/dsh-tools` 的 `ToolRuntime`，用 stub 工具模拟"插件自己的实现工具"。
`register` / `schemas` / `restrict` / `execute` / 嵌套 dispatch / guard / disposer
全部是出厂实现。

```powershell
cd dsh-capability-facade
node --import ./test/loader.mjs test/harness.mjs
# → OK — 49 passed, 0 failed
```

### 1.2 真机 headless A/B/C

一个一次性 DSH profile（`facade-test`）＝ `dsh-base` + `dsh-headless` + 本插件 + 一个
fixture 插件。fixture 注册两个实现工具（`pdf_extract`、`pdf_layout`）并把每次 dispatch
写进 JSONL 审计文件，于是可以区分"模型调了 facade"和"模型调了底层工具"。

三臂（`FACADE_ARM` 环境变量）：

| 臂 | 注册内容 |
| --- | --- |
| `raw` | 只注册两个实现工具（对照基线） |
| `capability` | 两个实现工具 + `pdf` capability（`pdf_analyze` = extract → layout） |
| `hidden` | 同 `capability`，并尝试用 `ctx.tools.restrict()` 隐藏底层工具（负对照） |

任务固定：

```powershell
dsh --profile facade-test "Analyze the PDF at C:\temp\report.pdf and tell me exactly two numbers: how many pages it has and how many layout blocks it has."
```

---

## 2. 结果

### 2.1 机制：成立

`capability` 臂审计日志（`experiment/audit/calls-capability.jsonl`）：

```json
{"arm":"capability","event":"mount"}
{"arm":"capability","event":"capability","id":"pdf","operations":["pdf_analyze"],"tools":["pdf_extract","pdf_layout"]}
{"arm":"capability","event":"tool","tool":"pdf_extract","path":"C:\\temp\\report.pdf","nested":true,"rootCallId":"call_00_ET_muyrs8wuy2nr1oNgfap10064"}
{"arm":"capability","event":"tool","tool":"pdf_layout","path":"C:\\temp\\report.pdf","nested":true,"rootCallId":"call_00_ET_muyrs8wuy2nr1oNgfap10064"}
```

读法：

- 模型调用的是 `pdf_analyze`（语义操作），不是两个底层工具；
- 两步都是 **nested**，且共享**同一个 rootCallId** —— 一次模型调用跑完整条管线；
- 顺序与声明一致（extract → layout）。

模型最终回答 `2 pages / 7 layout blocks`。

### 2.2 对照：raw 臂

```json
{"arm":"raw","event":"tool","tool":"pdf_extract","path":"C:\\temp\\report.pdf","nested":false,"rootCallId":"call_00_Z6kXiHIJAkNxE1q5higk7399"}
{"arm":"raw","event":"tool","tool":"pdf_layout","path":"C:\\temp\\report.pdf","nested":false,"rootCallId":"call_01_lQ81m6uUaOdrMh8xrBAL4468"}
```

两次独立 root 调用 —— 顺序与完整性由模型自己负责。任务简单时两者都对；差别在
"顺序/完整性由谁保证"。

### 2.3 权威未被洗白

harness 第 6 组：对底层工具注册 `ctx.tools.guard()` 后，facade 调用返回

```
ok:false, failedStep:"pdf_extract", error:"denied by policy: pdf_extract is not allowed here"
```

守卫没有执行、拒绝理由逐字到达模型。facade 没有旁路。

### 2.4 收窄：不成立（本实验最重要的负结果）

`hidden` 臂审计日志（`experiment/audit/calls-hidden.jsonl`）：

```json
{"arm":"hidden","event":"restrict","outcome":"refused",
 "message":"tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead"}
```

两个独立事实把"facade 隐藏底层工具"这条路封死：

| 事实 | 证据 |
| --- | --- |
| 被 `restrict()` 掉的全局工具，对**嵌套 dispatch** 也不可见（`UNKNOWN_TOOL`） | harness 测试 9 |
| `restrict()` 只接受**继承层**（全局/祖先）工具名；scope 自己注册的工具名直接报 `unknown global tool` | harness 测试 10 |
| host 面注册者根本装不上 restriction（需要 agent scope） | `hidden` 臂 |

根因是 DSH 的设计本身：**一个 visibility resolver 同时喂 presentation、lookup 和
dispatch**（`dsh-tools` 文档原话）。隐藏即不可执行——这不是 bug，是"通告面与可调用面
保持一致"的刻意约束（PTC 模式同一句话：announced surface = callable surface）。

### 2.5 观察：底层工具仍可见时，模型可能自己去核对

第一次 `capability` 臂里，模型除了 `pdf_analyze` 还额外直接调了
`pdf_extract` + `pdf_layout` 做"独立核对"；复现时没有出现（N=1 的随机性）。这说明：

> 只要底层工具还在模型面前，facade 就不是"唯一入口"，而是"更好的入口之一"。

---

## 3. 结论

### 3.1 facade 的真实价值（有证据）

1. **确定性顺序**：步骤顺序、每步参数由代码决定，不是模型的判断；
2. **语义命名**：模型在"操作"之间选择，而不是在"原语"之间选择；
3. **一次调用跑完**：1 次 root 调用 + N 次 nested dispatch，而不是 N 次 root 调用；
4. **零成本**：不声明 capability 时，schema/提示词/代码路径增量都是 0。

### 3.2 facade 做不到的（有证据）

**它不能让已经 model-facing 的工具消失。** 因此：

- 如果插件已经把 N 个原语注册给模型，facade 只会让 surface 变成 N + M（M = 语义操作数）；
- 真正"插件数 ↑ 但工具数不线性 ↑"的做法是**作者一开始就不把实现细节注册成 model-facing
  tool** —— facade 正是为这种写法提供的接口。

### 3.3 一句话

> Capability Facade 不是"治理工具面的层"，而是"**写出更窄工具面的方式**"。
> 它把"隐藏"从运行时动作变成作者的设计决定。

---

## 4. 复现

```powershell
# 1. registry 级（49 项）
cd dsh-capability-facade
node --import ./test/loader.mjs test/harness.mjs

# 2. 真机三臂（一次性 profile，脚本会复用已装好的包图）
pwsh -File ..\experiment\setup-profile.ps1
$env:FACADE_ARM='raw';        dsh --profile facade-test "<task>"
$env:FACADE_ARM='capability'; dsh --profile facade-test "<task>"
$env:FACADE_ARM='hidden';     dsh --profile facade-test "<task>"
Get-Content experiment/calls.jsonl
```

## 5. 诚实标注

- 三臂各 1 次运行，**N=1**，只能证明机制成立与边界存在，不能给出统计意义上的行为差异；
- stub 工具是确定性的，实验测的是"模型是否使用语义操作 + 管线是否真的按序执行"，
  不是真实 PDF 解析质量；
- 未测：多 capability 并存时的命名冲突/选择质量；长管线（≥5 步）的失败恢复策略；
  facade 与 PTC 模式（`run_code`）叠加时的表现。
