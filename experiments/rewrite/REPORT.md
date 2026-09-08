# 实验：把我们自己的插件改写成 capability 面

日期：2026-09-09 · 状态：机制已验证（registry 级 + 真机 headless）· 结论：**能改写，但只有"真的能合起来"的操作才值得声明**

---

## 0. 这次实验要回答什么

前两个实验证明了：

- Capability Facade 的机制成立（声明式语义操作 + 确定性管线 + 守卫照常）；
- 它**不能**隐藏已经暴露的工具。

那么剩下一个实际问题：

> **把我们自己的插件（maker / trajectory）改写成 capability 面，到底能得到什么？**

这个仓库里没有改任何插件源码。`experiments/rewrite/demo-capability/` 只是**声明**：
在既有工具之上加一层语义操作，然后测量差异。

---

## 1. 对象

| 插件 | 当前模型可见工具 | 这次声明 |
| --- | --- | --- |
| `dsh-plugin-maker` | 6（checklist / impact / scaffold / check / vet / adopt） | `maker_check` = check → vet |
| `dsh-trajectory-tools` | 4（sessions / find / window / trace） | `trajectory_locate` = find → window |

**只声明真的能合起来的操作**，这是这次实验最重要的取舍：

- maker 的 6 个工具里，只有 `check` + `vet` 回答同一个问题（"这个插件合规吗？"）且入参相同（一个 `targetDir`）；
- `checklist` 要 `taskType`、`impact` 要 `keyword`、`scaffold` 要 name/description/targetDir、`adopt` 要 targetDir——
  它们参数形状不同、回答不同的问题，**硬合成一个操作只会让模型更难用**；
- trajectory 的 `find → window` 是天然两步：先定位、再取原文窗口。

> 这一条是实验的负结论之一：**capability 的价值来自"合起来回答一个问题"，不是来自"把数量变少"。**

---

## 2. 方法

### 2.1 registry 级（真机库）

`experiments/rewrite/test.mjs` 在真实 Cordis Context + 真实 `dsh-tools` 上，
用**携带真实工具名与参数形状**的 stub 复现两个插件的工具面，然后加载 facade + demo 声明：

```powershell
node --import ./test/loader.mjs experiments/rewrite/test.mjs
# → OK — 14 passed, 0 failed
```

### 2.2 真机 headless

一次性 profile `rewrite-demo` = `dsh-base` + `dsh-headless` + **真实的**
`dsh-capability-facade` + **真实的** `dsh-plugin-maker`（当前工作树版本）+ demo 声明。

```powershell
dsh --profile rewrite-demo "Use the maker_check operation on <maker dir> and tell me in one line whether it passed and how many issues it found."
```

---

## 3. 结果

### 3.1 表面

| 项 | 值 |
| --- | --- |
| maker 原工具数 | 6 |
| 声明 `maker_check` 后 | 6 + 1（原语仍在） |
| trajectory 原工具数 | 4 |
| 声明 `trajectory_locate` 后 | 4 + 1 |

**诚实读法**：这是 facade 的边界——它加的是"更好的入口"，不是"更少的工具"。
要让数量真的下降，作者必须**不再把原语注册成 model-facing**（见约束文档）。

### 3.2 行为（registry 级，14/14 全过）

- `maker_check` 一次调用跑完 `plugin_maker_check` → `plugin_maker_vet`，两步都是 **nested**、共享同一个 `rootCallId`；
- 两步都收到 operation 的入参（`targetDir`），与直呼时一致；
- `trajectory_locate` 一次调用跑完 find → window，返回值里逐步带 `tool` / `ok` / `value`；
- 步骤工具缺失时**不声明**（fail-soft）：部署只装了其中一个插件时不会留下半个操作。

### 3.3 真机（headless）

模型选择调用 `maker_check`（不是分别调 check + vet），拿到的回答是：

> ✅ Passed — `dsh-plugin-maker` cleared contract, release-compliance, upgrade-baseline,
> migration, secrets, and danger self-check steps with **0 issues found**
> (only 2 advisory self-reference reminders and 1 optional upstream-attach suggestion, no violations).

这正是 `check` + `vet` 两份输出合起来的结论。

---

## 4. 结论

1. **机制可复用**：不改插件源码，只声明一层，就能让模型用语义操作代替多原语编排。
2. **合不起来的不要硬合**：maker 的 6 个工具只合出 1 个操作；硬凑成 3 个（plan/build/check）会让
   参数形状互相打架，反而更难用。
3. **数量不变**：facade 加入口，不减原语。要减原语，作者得改注册方式。
4. **真正的收益点**：把"模型要按顺序调两个工具、且第二个依赖第一个的位置"这类编排，
   从模型侧挪到代码侧。

## 5. 未验证 / 下一步

- N=1 的 headless 运行，只能证明"模型会用这个操作"，不能给统计结论；
- 没有测量：多 capability 并存时的选择质量、长管线（≥5 步）的失败恢复；
- 没有做的事：把 maker 的原语改成不再注册（那会改变插件行为，属于作者决策，不属于本实验）。
