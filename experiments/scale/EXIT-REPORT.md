# 出口实验：facade 不覆盖任务时，能不能自然退出？

日期：2026-09-09 · 状态：多轮（含一次被实验设计污染的返工）· 结论：**出口必要，但"有出口"和"有信号"都不够——出口必须可发现**

---

## 0. 问题

多任务实验暴露了 facade 的封闭世界：任务不在覆盖面内时模型没有出口。这条单独验证，分三步：

1. 加一个出口（`pool_primitive`，按名调用任意原语）；
2. 加一个**覆盖信号**（操作无法回答时返回 `covered: false` + 原因）；
3. 看换路是否变快。

## 1. 设计

同一 157 工具池、同一 15 个操作，三臂：

| 臂 | 模型可见面 |
| --- | --- |
| `sc-facade` | 15 个操作（封闭世界） |
| `sc-exit` | 操作 + `pool_primitive`（出口） |
| `sc-signal` | 操作 + 出口 + **每条操作声明期望字段，缺字段即 `covered:false`** |

## 2. 结果（关键几次，调用数方差很大）

| 臂 | T3 标题（不覆盖） | T4 日志（不覆盖） | T5 仓库（覆盖） |
| --- | --- | --- | --- |
| `sc-facade` | 16–32 次，**出现过答错** | 1–2 次 ✅ | 8–14 次 ✅ |
| `sc-exit` | 30–**482** 次 ✅ | 2 次 ✅ | 2–3 次 ✅ |
| `sc-signal` | **15–16 次** ✅ | 2 次 ✅ | 5–15 次 ✅ |

### 2.1 信号确实生效

`sc-signal` 的 `pdf_analyze` 返回：

```json
{ "covered": false,
  "reason": "this operation does not carry the fields pdf_metadata.title, …",
  "hint": "try another semantic operation, or pool_primitive for a specific capability" }
```

在干净的 T3 对照里，`sc-signal` 是**调用最少**的一臂（15–16 次），而封闭臂要穷举 15 个操作。

### 2.2 但出口本身不可用——因为它不可发现

`sc-exit` 的一次 T3 里，模型调了 **467 次 `pool_primitive`**，全在猜原语名字：

```text
pool_primitive {"name":"__list_capabilities__"}
pool_primitive {"name":"doc_read"}
pool_primitive {"name":"doc_title"}
pool_primitive {"name":"document_title"}
pool_primitive {"name":"documents_list"}
```

**模型不知道池子里有哪些原语**。一个只能按名调用的出口 = 一个没有目录的仓库。
这直接对应社区为什么用 `search → call` 而不是 `call`（#2138 / #2137）。

## 3. 结论

1. **出口必要**：没有它，封闭世界会出现"答错"（把"我没找到"当"没有"）。
2. **信号有效**：`covered:false` + 逐字段原因让模型更早换路（最少调用的一臂）。
3. **但出口必须可发现**：`pool_primitive(name)` 这种"盲调"出口在真实任务里退化成几百次猜测。
   正确形态是 **出口自带发现能力**：

```text
operation 不覆盖  →  出口：list / search 原语  →  按名调用
```

   也就是：**facade 的出口本质上就是 ToolSearch**。这条把两个实验线接上了。

## 4. 实验方法学：两次被设计污染

这次实验返工了两轮，原因都值得记下来：

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| `pdf_analyze` 被信号判为"不覆盖" | 路由把 `path: 'report'` 拼成 `/report/report`（404） | 资源 id → 端点显式映射 |
| 模型反复把资源当文件（`report.pdf`/`report.md`） | 资源 id 用了像文件名的词（`report`/`locked`） | 改成不像路径的 id（`doc-2f8a`/`repo-4d07`） |

**教训：facade 实验里，"资源 id 的形状"本身就是实验变量**。id 像路径 → 模型走文件系统语义 →
测出来的是 id 设计，不是 facade 设计。

## 5. 未验证

- 调用数方差极大（15–482），只能作方向性证据；
- 没有测"出口带 list/search"的版本（这是下一步）；
- 没有测多任务下信号误报率（作者声明的期望字段可能过严或过松）。
