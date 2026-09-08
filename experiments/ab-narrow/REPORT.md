# A/B：收窄工具面（6 → 1）改变了什么

日期：2026-09-09 · 状态：N=2/臂（严格任务）+ N=1（宽松任务）· 结论：**surface 变小不等于调用变少；省的是"选择成本"，不是"工作成本"**

---

## 0. 问题

`experiments/rewrite/` 证明了 facade 只能加入口、不能收窄。那么**真正的收窄**（作者一开始就只注册语义操作、不注册原语）会发生什么？

## 1. 设计

同一个任务，同一份 `dsh-plugin-maker` 的**同一套逻辑**，两种"作者写法"：

| 臂 | 挂载 | 模型可见工具 |
| --- | --- | --- |
| `an-wide` | 真实 `dsh-plugin-maker`（6 个工具） | `plugin_maker_{checklist,impact,scaffold,check,vet,adopt}` |
| `an-narrow` | `dsh-narrow-maker`（1 个工具） | `maker_check` |

`an-narrow` 的插件**只注册一个** `maker_check`，内部直接调用 maker 的纯函数
（`checkPlugin` + `vetPlugin`）——maker 包在 node_modules 里可见（供 import），
但**不作为 bundle 挂载**，所以它的 6 个工具一个都没注册。

审计：`experiments/ab-make/audit-plugin/` 监听 `tools/result`，逐次记录 `tool / nested / rootCallId`。

```powershell
pwsh -File experiments/ab-narrow/ab-narrow.ps1 -Runs 2
pwsh -File experiments/ab-narrow/ab-narrow.ps1 -Runs 2 -Label strict -Task "Call the check tool exactly once ... Do not run any other tool ..."
```

## 2. 结果

### 2.1 严格任务（"只调一次检查工具，别做别的"），每臂 2 次

| 臂 | run | 调用次数 | 调用的工具 |
| --- | --- | --- | --- |
| an-wide | 1 / 2 | **1 / 1** | `plugin_maker_check` |
| an-narrow | 1 / 2 | **1 / 1** | `maker_check` |

**两臂完全一样**：都是 1 次调用、都正确拿到结论。
差别只在**模型面前有几个选项**：6 个 vs 1 个。

### 2.2 宽松任务（"检查它，说清要修什么"），每臂 1 次

| 臂 | 调用次数 | 工具 |
| --- | --- | --- |
| an-wide | **2** | `plugin_maker_check` → `plugin_maker_vet` |
| an-narrow | **26** | `maker_check` + `pwsh`×13 / `read`×7 / `grep`×2 / `write`×1 |

narrow 臂没有"因为工具少而变笨"——它调完 `maker_check` 后，用通用工具去挖
**check 没覆盖的东西**（CHANGELOG 停在 0.6.6 而版本已 0.6.20、工作树未提交、文档与
upstream.json 的 pin 不一致），最后写了一个文件。

### 2.3 怎么读

1. **严格任务下，surface 大小不影响调用数**——6 个选项和 1 个选项，模型都只走一步。
2. **宽松任务下的 26 次不是"surface 的代价"，是"任务没界定边界"的代价**：模型自己决定
   要额外调查多少。同一任务换一臂，它也可能选择不调查。
3. **收窄真正省掉的是"选择成本"**：模型不必在 6 个名字里判断该用哪个、该按什么顺序组合；
   它拿到的是"一个明确入口"。这在多插件、几十个工具的环境里才体现价值，单插件场景看不出来。

## 3. 结论

- **收窄是作者态决策**：`an-narrow` 的 1 个工具不是 facade 隐藏出来的，是作者**没注册**那 6 个。
- **surface ≠ 调用数**：这次实验把"工具少了模型就更省"这个直觉证伪了（严格任务下两臂同为 1 次）。
- **收窄的收益点是认知负载，不是步数**：需要更大规模（多插件、几十个工具）的实验才能测出
  它在真实场景里的价值。

## 4. 未验证 / 局限

- 每臂 N=1~2，且宽松任务两臂的任务边界不同（模型自行决定调查深度）；
- 没有多插件、几十个工具的场景——那才是收窄真正该证明价值的地方；
- 没有测 token/耗时（只有调用次数）。

## 5. 附带产物

`an-narrow` 用的 `dsh-narrow-maker` 暴露了一个通用写法：**一个插件只暴露一个语义工具，
内部复用别的插件的纯函数**。这也顺带要求 maker 把 `vet` 逻辑做成可复用的纯函数
（已抽成 `vetPlugin`），否则别人只能重写一遍。
