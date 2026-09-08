# 规模实验：157 个底层工具下的 Raw / ToolSearch / Facade 三臂

日期：2026-09-09 · 状态：N=1/臂，机制与体量级证据 · 结论：**两者解决不同问题，不是竞争关系**

---

## 0. 为什么换规模

前两组 A/B（`experiments/ab-make/`、`experiments/ab-narrow/`）都在 6 个工具的世界里做，
结论只能是"决策空间小的时候压缩没收益"。社区的真实规模不是这个量级：

| 社区现象 | 出处（已核对原文） |
| --- | --- |
| Godot MCP Pro 完整模式 **178 个工具**，撞 DSH 单请求 128 function 上限 | #2588 |
| MCP Lens：**1,000 MCP tools → 2 个模型入口**（`mcp_search` + `mcp_call`） | #2137 |
| 工具定义常驻 **7.4K token**；某轮 533 次调用 × 9.1K ≈ 4850K token | #5278 |
| minimal preset 仍被插件全局工具污染 | #5786 |

## 1. 设计

一个 157 个工具的池子（8 个域：git 20 / browser 22 / db 19 / pdf 20 / image 18 / net 18 / cloud 20 / fs 20），
规格取自真实插件与 MCP 的命名与参数形态。三臂：

| 臂 | 模型可见面 | 实现 |
| --- | --- | --- |
| `raw` | 157 个池子工具 + 25 个内置 = **182** | 每个池子工具各注册一个 |
| `search` | `pool_search` + `pool_call` + 25 = **27** | 社区解法：search → call |
| `facade` | 15 个语义操作 + 25 = **40** | 本仓库解法：原语不注册，只声明操作 |

关键设计（两次失败后才对）：

1. **池子必须是唯一通路**。第一版池子只回显参数，模型发现没用，全部回退 `pwsh`；
   第二版给池子接了一个 loopback mock 服务（`/report` → `{pages:2}`、`/repo` → `{branch:"main"}`），
   并用 guard 挡住 `pwsh` 直连该端点（内置 `web_fetch` 自带 SSRF 保护，够不着 loopback）。
2. **测量必须用 agent scope**。`ctx.tools.schemas()` 按 scope 解析，root 视图是空的；
   在 `agent/created` 拿到 agent 后按 agent 取样才看得到模型真实可见面。

```powershell
# 先起 mock 服务（后台）
pwsh -File experiments/scale/scale.ps1
```

## 2. 结果

### 2.1 表面体量（确定性测量，与模型无关）

| 臂 | 可见工具 | schema 字节 | 相对 raw |
| --- | ---: | ---: | ---: |
| `raw` | **182** | **54,310** | — |
| `search` | **27** | **26,680** | −51% |
| `facade` | **40** | **31,040** | −43% |

### 2.2 行为（同一任务，三臂都答对）

任务：从池子取两个值（PDF 页数、git 分支），且池子是唯一通路。

| 臂 | 调用 | 根调用 | 用到的工具 |
| --- | ---: | ---: | --- |
| `raw` | 2 | 2 | `git_branch`, `pdf_page_count` |
| `search` | 4 | 4 | `pool_search` ×2, `pool_call` ×2 |
| `facade` | 2 | 2 | `git_inspect`, `pdf_analyze` |

读法：

- **search 用多 2 次模型往返换掉 27KB schema**：先搜、再调，是它的固有成本；
- **facade 和 raw 步数相同**（2 次），但 facade 少 43% 的 schema；
- 三臂答案都正确——这一层没有"谁更聪明"，只有"代价花在哪"。

### 2.3 三种形态的定位

| | 适合 | 代价 |
| --- | --- | --- |
| `raw` | 工具少（≤ 十几把） | schema 常驻，选择面宽 |
| `search` | **能力空间巨大、工具间关系不确定**（MCP、上千工具、长尾） | 每用一次多一轮往返；搜索质量决定一切 |
| `facade` | **能力内部关系稳定、重复组合明显**（插件自己的固定流程） | 需要作者真的知道哪些原语该合；合不出来就没有收益 |

**它们不是竞争关系。** 最合理的最终形态可能是叠起来：

```text
1500 implementation tools
      ↓  作者态收窄（facade）
100 semantic operations
      ↓  工具面发现（ToolSearch）
10 visible operations
```

## 3. 结论

1. **规模改变结论**：6 个工具时压缩没有收益；157 个工具时，schema 从 54KB 降到 27–31KB，
   这个量级才和社区抱怨（7.4K token 常驻）对上。
2. **facade 是独立的**：它做的事 search 做不到——把"本来固定的一组调用"变成一次调用，
   而不是把工具藏起来再让模型找回来。
3. **facade 不能替代 search**：facade 的收益上限是"作者能合出来的操作数"；
   合不出来的长尾仍然需要一个发现机制。
4. **本仓库的边界依然成立**：facade 的窄 surface 来自"原语不注册"，不是运行时隐藏。

## 4. 未验证 / 局限

- N=1/臂；任务只有一个（两个取数问题），没有复杂多步任务；
- 池子是"真实规格的合成池"，不是真实 MCP server（沙箱下 stdio MCP 不可用，
  loopback HTTP 又被内置 web_fetch 挡住）；
- 没有测 token 成本与缓存命中（只测了 schema 字节数与调用次数）；
- 没有测"合不出来的长尾"在 facade 臂里的表现——那是 facade 的真实短板，需要多任务设计。

## 5. 附带产出

- `experiments/scale/pool-spec.mjs`：157 工具池 + 15 个语义操作的声明；
- 三个臂插件 + measure / guard / audit 插件，全部可复跑；
- 两个坑已记录在代码注释里：**`tools.schemas()` 按 scope 解析**、
  **大行注册可能晚于 `agent/created`**。
