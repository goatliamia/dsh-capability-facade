# 判断：Capability Facade 这个方向对不对

日期：2026-09-09 · 依据：本地 registry 实测（49 项）+ 真机 headless 三臂实验 + DSH 官方源码/文档

---

## 一、总判断

**方向对，但你的表述里有一处需要改。**

对的部分：

> DSH 追求的是"运行时可以很复杂，但给模型的接口是一个经过设计的、语义明确的 capability"。

这条和官方实现完全一致，而且比"工具面治理"更接近 DSH 的原意。证据在源码里随处可见：

- `dsh-tools` 的类注释：**"一个 visibility resolver 同时喂 presentation、lookup 和 dispatch"**；
- PTC 模式：通告面 = 可调用面，模型直呼非 `run_code` 工具直接 `UNKNOWN_TOOL`；
- `dsh-scope`：scope 只隔离"注册进来的东西"，不是任意服务的隔离；
- 官方对 MCP 的处理：MCP 工具**照原样**注册进 `ctx.tools`（`ctx.tools.register()`），
  并没有为 MCP 单独造一层"协议直通"——说明官方并不认为 tool 就等于 capability，
  它只是让 MCP 自己承担"暴露得够不够语义"的责任。

需要改的表述：

> "把一堆底层工具收敛成少数几个语义入口"——**在 DSH 当前机制下，"收敛"不能由第三方
> 插件在运行时完成**。收敛只能由**插件作者在写插件时**完成。

这不是我们的实现没做好，是机制使然（见第二节）。

---

## 二、为什么"运行时收敛"不可能：一条硬约束

DSH 的可见性是**三合一**的：`schemas()` / `get()` / `execute()` 内部的
`resolveExecution()` 共用同一份可见集合。所以：

- 一个工具对模型隐藏 → 对嵌套 dispatch 也隐藏；
- `restrict()` 只能命名**继承层**的工具（scope 自己注册的名字直接报错）；
- host 面注册者根本装不上 restriction（需要 agent scope）。

三条都有实测证据（见 `dsh-capability-facade/docs/constraint-restrict-vs-nested-dispatch.md`）。

**推论：**

| 设想 | 现实 |
| --- | --- |
| 插件给了 7 个工具，我们写个插件把它们收成 2 个 | ❌ 收不了。底层 7 个仍然在模型面前；我们会变成 7 + 2 |
| 插件作者自己只注册 2 个语义操作，7 个原语留在 runtime | ✅ 这才是 DSH 支持的做法 |
| 用一个 `call(toolName, args)` 万能入口 | ❌ 也收不了（同样受约束），而且更糟：模型失去了按名选择的能力 |

---

## 三、那这个插件应该是什么

**它应该是一个"写窄工具面的方式"，不是"治理工具面的层"。**

```text
        Runtime
           │
        Plugin
           │
        Service
           │
      Capability            ← 作者在这里做设计决定
       /      \
 runtime API   model API
 many ops      few semantic ops
                   │
                  LLM
```

具体形态（v1 已实现并验证）：

- 作者声明 `{ id, description, operations }`；
- 每个 operation → 一个模型可见工具（`pdf_analyze`、`pdf_modify`），**不是** `use_capability(capability, operation)`；
- 每个 operation 是**声明的确定性管线**，步骤通过 `ctx.tools.execute()` 嵌套 dispatch 执行；
- 因此守卫/审批/取消/结果契约**照常生效**（实测：守卫拒绝原样到达模型）；
- 不声明 → 0 schema、0 prompt、0 代码路径。

---

## 四、三原则对照（用户给的判断标准）

### 1. 渐进披露

- **符合**：作者只暴露语义操作；底层实现细节不进模型视野（前提是作者不注册它们）。
- **不做的事**：没有 `tool_search`、没有按轮次动态增删工具、没有"先给目录再给细节"的二次
  往返。因为 DSH 的模型接口应当**一开始就窄**，而不是"宽 + 检索"。
- 与 `trajectory-tools` 的对比：那个插件用"4 个工具 + 一个 skill"做渐进披露，是**另一种**
  正确的披露方式（知识面渐进）。facade 处理的是**能力面收敛**，两者不冲突。

### 2. 水位哲学：不变不动

- **符合**：facade 默认不隐藏任何东西、不改动任何已有工具、不接管执行路径；不声明
  capability 时进程内零影响。
- **符合**：registration 是 fail-loud 的——工具不存在就抛错，而不是"先注册一半，运行时
  再说"。宁可在挂载时失败，不要在模型调用时才发现。
- **符合**：我们没有去改 DSH 的任何现有机制，只是用它的公开 seam。

### 3. 不额外增负、不降低性能

- **零声明时**：0 成本。
- **声明后**：每个语义操作 = 1 个 schema（约几十 token）；一次模型调用替代 N 次 root 调用
  （省的是 N 次模型往返，不是省 schema）。
- **不成立的地方（必须诚实）**：如果底层工具仍然 model-facing，我们是在**加**工具，不是
  减。这一条只有在作者按第三节写插件时才成立。
- **不降低性能**：嵌套 dispatch 走的是同一条管线，没有额外审批往返、没有额外模型调用；
  facade 自身不做 IO、不持状态。

---

## 五、和现有自研插件的关系

| 项目 | 形态 | 和 facade 的关系 |
| --- | --- | --- |
| `dsh-runtime-seam` | 执行路径两侧的确定性承接（guard/circuit/delta/continuation） | **互补**：facade 的步骤照常被 guard/circuit 覆盖（实测）；runtime 管"能不能做"，facade 管"模型怎么表达要做的事" |
| `dsh-trajectory-tools` | 4 个 model-facing 只读工具 + skill | **可以成为第一个真实用例**：`trajectory_locate`（find → window）就是天然的两步管线；本会话的动态探针已注册成功并可被模型调用 |
| `dsh-analysis-view` | 客户端分析面板 | 无关 |
| `visual-html-agent-editor` | MCP 直通（14 个工具） | **反面参照**：14 个 MCP 工具直接进模型视野，正是 facade 想避免的形态 |
| `project-context-bridge` | 事实/上下文桥 | 无关 |

`dsh-runtime` 的"事件是事实源、runtime 尽量安静、模型看不清的地方才介入"这套原则，与
facade 的"模型看得清的地方不要给它更多原语"是同一件事的两面。

---

## 六、建议的下一步（按优先级）

1. **先在一个真实插件上试**：`trajectory-tools` 的 `trajectory_find → trajectory_window`
   是最自然的两步管线。用它验证"真实插件作者是否愿意这样写"。
2. **补一个 capability 的命名/发现约定**：多个插件各声明 capability 时，如何避免
   `pdf`、`doc`、`document` 三个近义 id 打架。可能只需要一个文档约定。
3. **不要现在做**：动态增删、按轮次判断、工具搜索、`use_capability` 万能入口。
   这些要么违反 DSH 的可见性约束，要么把窄接口变回宽接口。
4. **可选的上游建议**（不属于本插件）：如果社区确实需要"内部工具"语义，可以向上游提议
   一个"仅内部注册"的 tool 层（对模型不可见、对指定 owner 可 dispatch）。这是唯一能真正
   实现"运行时收敛"的路径，但它是 DSH 的能力，不是插件的。

---

## 七、一句话结论

> **不要做 Tool Surface Manager；做 Capability Facade。**
> 但要把它的定位说准：它不是"把 N 个工具收成 M 个"的工具，而是"**让插件作者能写出
> M 个语义操作而不是 N 个原语**"的接口。前者 DSH 不允许，后者 DSH 正需要。
