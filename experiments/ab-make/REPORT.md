# A/B：facade 在真实插件上改变了什么

日期：2026-09-09 · 状态：N=1，机制级证据 · 结论：**改变了"模型要走几轮"，没有改变"答案对不对"**

---

## 0. 问题

前几个实验证明了机制（能跑、守卫照常、不能隐藏工具）。但一直缺一个真实场景里的问题：

> **给真实插件加一层 capability，模型的行为到底变了什么？**

## 1. 设计

同一个任务、同一份真实 `dsh-plugin-maker`（v0.6.20，6 个模型可见工具），两个一次性 profile：

| 臂 | 挂载 | 模型可见的 maker 工具 |
| --- | --- | --- |
| `ab-raw` | maker + 审计插件 | 6 个原语 |
| `ab-cap` | maker + **facade + capability demo** + 审计插件 | 6 个原语 **+ `maker_check`** |

任务固定：

> Use the plugin workshop tools to check the directory `<maker>`: does it pass, and what exactly needs fixing? Answer in at most 5 lines.

审计：`experiments/ab-make/audit-plugin/` 监听 `tools/result`（注册表的最终观测点，**嵌套调用也会触发**），把每次调用写成 JSONL。

```powershell
pwsh -File experiments/ab-make/ab-make.ps1
```

## 2. 结果

### 2.1 原始审计

`ab-raw`：

```json
{"tool":"plugin_maker_check","nested":false,"callId":"call_00_1V0…","rootCallId":"call_00_1V0…"}
{"tool":"plugin_maker_vet",  "nested":false,"callId":"call_01_AoP…","rootCallId":"call_01_AoP…"}
```

`ab-cap`：

```json
{"tool":"plugin_maker_check","nested":true, "callId":"call_00_ET_…:maker.check:1","rootCallId":"call_00_ET_…"}
{"tool":"plugin_maker_vet",  "nested":true, "callId":"call_00_ET_…:maker.check:2","rootCallId":"call_00_ET_…"}
{"tool":"maker_check",       "nested":false,"callId":"call_00_ET_…",            "rootCallId":"call_00_ET_…"}
```

### 2.2 读法

| | `ab-raw` | `ab-cap` |
| --- | --- | --- |
| 根调用（模型轮次） | **2**（两个不同 rootCallId） | **1** |
| 底层工具执行次数 | 2 | 2 |
| 执行方式 | 模型分别调两个原语 | facade 在**同一次调用内**按序跑完两步 |
| 答案正确性 | 正确（"通过，0 需修复"） | 正确（同一结论） |

**结论**：capability 把"两次模型往返"压成"一次模型往返"，代价是模型可见工具从 6 变成 7（原语仍在）。
底层工具该跑几次还是几次——变的只是**谁负责编排**：从模型挪到了声明里。

### 2.3 一个附带观察

`ab-cap` 的审计里只有**一个** rootCallId，说明这次运行模型没有额外去直呼原语核对。
但 `ab-raw` 那次的 3 次调用里出现过 `plugin_maker_checklist`（模型自己去找动作清单）——
这说明**模型的编排路径本身是不稳定的**，N=1 不足以断言"facade 一定更省"。
要下统计结论需要重复运行。

## 3. 这次实验确立的东西

1. **可测量的收益**：根调用数 2 → 1（编排从模型侧移到声明里）。
2. **不成立的期待**：工具数量没有下降（6 → 7）；facade 加的是入口，不是收窄。
3. **正确性不受影响**：两臂结论一致——facade 不是"更聪明的模型"，只是"更确定的顺序"。

## 4. 未验证

- N=1，且两次运行的模型编排路径不同（一次调了 checklist，一次没调）；
- 没测：多 capability 并存时的选择质量、长管线失败恢复、token 成本；
- 没测：把原语也去掉（不注册）之后的行为——那是插件作者的决策，会改变插件本身。
