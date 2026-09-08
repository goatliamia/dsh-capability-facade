# Agent 入口

一句话：**把"插件作者写窄工具面"变成一个可复用的 seam**——不是治理工具面，而是让作者能写出语义操作。

## 本仓库约定

- **一句话定位**：`dsh-capability-facade` 是 host-only 插件，提供一个 `ctx.capabilities` 服务；
  作者声明 capability + operations，每个 operation 变成一个模型可见工具，内部按声明顺序
  nested dispatch 既有工具。
- **先读**：`README.md`（结论与用法）→ `docs/constraint-restrict-vs-nested-dispatch.md`
  （那条硬约束，任何"收敛工具"的想法都必须先过这一关）。
- **证据优先**：任何关于"facade 能不能隐藏工具 / 能不能省 token / 模型会不会用"的结论，
  必须给出 registry 测试或 headless 实验证据；没有证据的写"未验证"。
- **不改 DSH 既有机制**：只使用公开 seam（`ctx.tools.register/execute/guard`、
  `dsh-scope`）。发现需要上游能力时，写进 `docs/DESIGN-REVIEW.md` 的"上游建议"，不在插件里绕。
- **fail-loud**：注册期能发现的问题（未知工具、重名、非法名）必须在注册期抛错，不要留到
  模型调用时。
- **零成本默认**：不声明 capability 时，插件不得产生任何 schema / prompt / 执行路径增量。

## 验证命令

```powershell
node --import ./test/loader.mjs test/harness.mjs     # 49 项，必须全过
pwsh -File experiments/setup-profile.ps1             # 一次性 profile（复用已装包图）
$env:FACADE_ARM='capability'; dsh --profile facade-test "<task>"
```

## 目录

- `lib/` — 插件本体（唯一发布物）
- `test/` — 真机 registry 测试（`loader.mjs` 只是本工作区的解析垫片，不随包发布）
- `docs/` — 设计评审 + 约束证据
- `experiments/` — headless 三臂实验（报告 / fixture / profile 脚本 / 审计日志）

## 不要做的事

- 不要为了"隐藏工具"去改运行时视野（已被实验否定，见约束文档）；
- 不要做 `use_capability(capability, operation, input)` 万能入口；
- 不要把 facade 变成"插件改造器"（那是另一个方向，见 `docs/DESIGN-REVIEW.md` 第六节）。
