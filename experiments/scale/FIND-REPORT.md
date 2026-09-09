# 出口实验（续）：可发现的出口，以及它没能解决的那一层

日期：2026-09-09 · 状态：四臂对照 · 结论：**出口可发现有用，但"参数映射"是更靠前的一层**

---

## 1. 这一轮加了什么

上一轮发现：按名调用的出口会退化成猜名字（一次 467 次 `pool_primitive`）。
本轮加第四臂 `sc-find`：出口支持三种模式——

```text
pool_primitive { mode: 'search', query: … }   → 排名 + 精确 schema
pool_primitive { mode: 'list' }               → 全部原语名（按域）
pool_primitive { mode: 'call', name, args }   → 执行
```

即把社区的 `search → call` 形态接到 facade 的逃生路径上。

## 2. 结果（T3 标题，操作不覆盖）

| 臂 | 调用 | `pool_primitive` | 其中 search | 其中 list | 答对? |
| --- | ---: | ---: | ---: | ---: | --- |
| `sc-facade`（封闭） | 37 | 0 | 0 | 0 | ✅ |
| `sc-exit`（盲调出口） | 31 | 14 | **0** | **0** | ✅ |
| `sc-signal`（出口+信号） | 7 | 3 | 0 | 0 | **弃答**（"没有合规路径，我不编造"） |
| `sc-find`（可发现出口） | 20 | 20 | **3** | **1** | ✅ |

### 2.1 可发现的出口确实改变了行为

`sc-find` 的调用序列开头是：

```text
{"mode":"search","query":"document report title","limit":10}
{"mode":"list"}
{"mode":"search","query":"title"}
{"mode":"search","query":"report"}
{"mode":"call","name":"pdf_metadata","arguments":{"path":"report.pdf"}}
…
```

它**先查目录再调用**，而 `sc-exit` 一次 search 都没有（它没有这个能力），上来就是
`document_title` → `pdf_metadata` 一路猜。**"出口必须可发现"这条被验证了。**

### 2.2 但它没解决真正卡住的地方：参数映射

两个臂**都没有把任务里给的 id `doc-2f8a` 传给 `pdf_metadata`**：

```text
sc-exit : pdf_metadata {path: "report"} / {path: "doc-2f8a"} / {path: "doc-7b31"} …  ← 猜到了 id
sc-find : pdf_metadata {path: "report.pdf"} / {path: "report"} / {path: "document"} …  ← 一直在猜路径
```

它们卡的不是"不知道有哪些工具"，而是"**不知道用户的 `doc-2f8a` 就是参数 `path`**"。
这是**参数语义**问题，比工具发现更靠前。

## 3. 结论（把两层分清）

| 层 | 问题 | 本轮证据 |
| --- | --- | --- |
| **工具发现** | 出口能不能被找到 | `sc-find` 先 search/list 再 call → **可发现出口有效** |
| **参数映射** | 任务里的值该填哪个参数 | 四臂全部靠猜 → **这层没解决，且它先发生** |

**所以 facade 设计里，"参数从哪来"和"工具有没有"是两件事，前者更关键。**
一条可落地的原则：

> 操作参数应当**直接使用调用方给出的标识**，不要要求模型把用户词汇翻译成内部词汇。
> 本次实验的 `path: doc-2f8a` 就是一个反例：参数名 `path` 暗示"文件路径"，
> 而真实语义是"资源 id"——模型于是必然去猜文件名。

## 4. 方法论提醒（累计三次污染）

| 污染 | 根因 | 修法 |
| --- | --- | --- |
| 信号误判"不覆盖" | 路由把 id 拼成 `/report/report`（404） | 资源 id → 端点显式映射 |
| 模型把资源当文件 | id 用了像文件名的词（`report`） | 改成 `doc-2f8a` |
| 本轮仍有人猜路径 | **参数名叫 `path`** | 应改名（如 `resource`）或改用 id 语义 |

三次都指向同一件事：**实验脚手架里的命名和路由，会被模型当成语义线索。**
做 facade 实验时，这些不是细节，是变量。

## 5. 未验证

- 调用数方差极大（7–482），只能作方向性证据；
- 没有做"参数名改为 `resource`"的对照——那是下一轮最该做的；
- `sc-signal` 的弃答行为只出现一次，是否稳定未知。
