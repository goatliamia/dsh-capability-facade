# dsh-capability-facade

**A Model Capability Facade for DeepSeek Harness.** A plugin declares one semantic capability
— a few operations the model should understand — and the facade turns each operation into one
typed, model-facing tool that runs a declared, deterministic pipeline of existing tools.

```text
implementation tools                 model-facing surface
pdf_extract ─┐
pdf_layout  ─┼── declared pipeline ──▶  pdf_analyze
pdf_ocr     ─┘                          pdf_scan
```

It is deliberately not a tool manager, not a `call(toolName, args)` dispatcher, and not a
governance layer. It is the model-facing half of an interface a plugin author designs.

---

## The finding behind this repository

DSH keeps its own seams narrow: a model talks to `ctx.fs`, `ctx.shell`, `ctx.llm` through a
designed interface, never through a provider's implementation protocol. Community plugins often
skip that discipline for tools — a plugin with fifteen internal operations registers fifteen
model-facing tools, and the model's world becomes the tool list.

The obvious fix — "write a plugin that hides the extra tools at runtime" — **does not work**,
and this repository exists partly to record why:

> DSH's tool registry resolves presentation, lookup, and dispatch through **one** visibility
> resolver. A tool hidden from the model with `ctx.tools.restrict()` is therefore also
> unreachable for a nested dispatch. Hiding is a three-in-one operation.

So a facade cannot shrink a surface that is already exposed. It can only help an author
**write a narrower surface in the first place**. That is what this plugin does, and the
measurements are in [`experiments/REPORT.md`](experiments/REPORT.md).

Read the full argument: [`docs/DESIGN-REVIEW.md`](docs/DESIGN-REVIEW.md) ·
the constraint and its evidence: [`docs/constraint-restrict-vs-nested-dispatch.md`](docs/constraint-restrict-vs-nested-dispatch.md).

---

## Install

```powershell
dsh plugin --profile <profile> add dsh-capability-facade-<version>.tgz
dsh --profile <profile> --dump-config   # expect one row: dsh-capability-facade
```

With no capability declared, the row contributes **zero** model-facing schema and zero prompt
text. Cost appears only where an author declares something.

## Use

A plugin reads the service and declares a capability. The steps must already be registered
(declare the facade row before the plugin that owns the tools, or inject `capabilities` and
register later — registration is fail-loud, so a wrong order is reported, not half-applied).

```js
export const inject = ['tools', 'capabilities']

export function apply(ctx) {
  // Implementation tools: registered, guarded, approval-aware — the normal way.
  ctx.tools.register(extractTool)
  ctx.tools.register(layoutTool)

  ctx.capabilities.register({
    id: 'pdf',                                   // → tool names pdf_*
    description: 'Read a PDF document: text, layout and OCR in one deterministic sequence.',
    operations: [
      {
        name: 'analyze',                          // → pdf_analyze
        description: 'Extract text and layout from a PDF in one call.',
        parameters: { path: { type: 'string', required: true } },
        steps: [
          { tool: 'pdf_extract' },                // receives the operation input
          { tool: 'pdf_layout', from: 'layout' }, // receives operation input.layout
        ],
      },
    ],
  })
}
```

What the model sees for `pdf_analyze`:

```text
Extract text and layout from a PDF in one call.

[capability pdf] Read a PDF document: text, layout and OCR in one deterministic sequence.
Steps (run in this order by the harness, one call): 1. pdf_extract → 2. pdf_layout
```

One model call runs the whole pipeline. Each step is a **nested dispatch** through
`ctx.tools.execute()` with the caller's agent and `parent: exec.token`, so guards,
`tools/pre-execute`, approvals, around-dispatch wrappers, post-execute, cancellation and result
materialization all still apply to the underlying tool. The facade adds a name and an order; it
does not add authority.

### Result shape

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

A failing step stops the pipeline and is reported with `ok: false`, `failedStep`, `error` and
the registry error `code`. A step whose `from` field is missing fails the same way without
dispatching. A guard denial is reported verbatim, so the model reads the policy reason, not a
generic failure.

### API

| Member | Meaning |
| --- | --- |
| `register(capability, { scope?, agent? })` | Validate + register one operation tool per operation. All-or-nothing. Returns the exact disposer. |
| `list()` | `[{ id, description, tools }]` for diagnostics/settings. Deliberately not a model-facing tool. |

`scope` registers the operation tools through an agent context (how a preset would use it);
`agent` is the scope key step names resolve against — pass it whenever the steps live in the
same agent scope, because a scope's own registrations are not part of that scope's view.

`register()` refuses: an unknown or restricted-away step tool, a duplicate capability id, a
duplicate operation tool name, an empty description, and a name that is not `[a-z][a-z0-9_]*`.
Everything it registered is withdrawn on dispose and on plugin unload.

---

## The one thing it cannot do

**The facade cannot hide the implementation tools.**

DSH's tool registry documents one visibility resolver feeding presentation, lookup, *and*
dispatch. A tool hidden from the model with `ctx.tools.restrict()` is therefore also
unreachable for a nested dispatch — the facade's own steps start failing with `UNKNOWN_TOOL`.
A tool registered in a scope cannot be hidden at all: `restrict()` only accepts names of
*inherited* (global/ancestor) tools.

This was measured, not assumed:

| Claim | How it was checked |
| --- | --- |
| A restricted global is unreachable for nested dispatch | harness tests 9 and 10 |
| `restrict()` refuses a scoped (own-layer) registration | harness test 10 |
| A host-plane registrant cannot install a restriction at all | headless `hidden` arm: `tools.restrict() requires a scoped context (agent.ctx)` |

So the facade's value is not "fewer tools than before". It is:

- **deterministic sequencing** — the order and the arguments each step receives are code, not
  a model decision;
- **semantic naming** — the model chooses between operations, not between primitives;
- **one call instead of N** — one root call, N nested dispatches.

If a plugin wants the model to see *only* the semantic surface, the author must not register
the implementation tools as model-facing in the first place. That is the design the facade is
built for.

---

## Evidence

Full write-up: [`experiments/REPORT.md`](experiments/REPORT.md).

**Registry tests** (`node --import ./test/loader.mjs test/harness.mjs`) — 49 assertions against
the real `@deepseek-ai/dsh-tools` on a real Cordis context, covering the registration contract,
fail-loud refusal, schema shape, pipeline execution, `from` mapping, guard enforcement, failure
semantics, disposal, both narrowing constraints, and agent-scoped declaration.

**Headless A/B/C** — three arms over a real DSH profile (`dsh --profile facade-test "<task>"`),
each tool call audited to JSONL:

| Arm | Model-facing tools | What the model did | Nested dispatches |
| --- | --- | --- | --- |
| `raw` | `pdf_extract`, `pdf_layout` | two separate root calls | 0 |
| `capability` | `pdf_analyze` (+ the two primitives) | one `pdf_analyze` call | 2, both under one root call |
| `hidden` | `pdf_analyze` (+ the two primitives) | one `pdf_analyze` call | 2; the restriction attempt was refused |

The `capability` arm is the mechanism working: the model reached for the semantic operation
and the harness ran both steps in the declared order under a single root call. The `hidden`
arm is the boundary working as designed — a host-plane registrant cannot narrow the surface.

---

## Repository layout

| Path | What it is |
| --- | --- |
| `lib/index.js` | The plugin (host-only, no runtime dependencies). |
| `cordis.patch.yml` | The bundle row a profile mounts. |
| `test/harness.mjs` | 49 assertions against the real registry, on a real Cordis context. |
| `test/loader.mjs` | Test-only resolution shim for this workspace (not shipped). |
| `docs/DESIGN-REVIEW.md` | Why the direction is right and where its boundary is. |
| `docs/constraint-restrict-vs-nested-dispatch.md` | The hiding constraint and its three proofs. |
| `docs/refactor-protocol-review.md` | Review of the follow-on idea ("refactor other plugins into semantic operations"): what is true, what is not, and where it belongs. |
| `experiments/` | The headless A/B/C experiment: report, fixture, profile setup, audit logs. |

## Reproduce

```powershell
# registry level (no DSH process needed)
node --import ./test/loader.mjs test/harness.mjs      # → OK — 49 passed, 0 failed

# real harness, three arms (one throwaway profile; reuses an installed package graph)
pwsh -File experiments/setup-profile.ps1
$env:FACADE_ARM='raw';        dsh --profile facade-test "<task>"
$env:FACADE_ARM='capability'; dsh --profile facade-test "<task>"
$env:FACADE_ARM='hidden';     dsh --profile facade-test "<task>"
Get-Content experiments/audit/calls.jsonl
```

## Design boundaries

- **Not a dispatcher.** There is no `use_capability(capability, operation, input)`. Each
  operation is a typed, named, described tool. A universal `call()` would replace "many tools
  the model cannot rank" with "one black box the model cannot reason about".
- **Explicit only.** Nothing is derived from tool names or metadata. A capability is declared
  by the author who knows which primitives belong together and in what order.
- **No new state.** No sessions, no storage, no timers. Registration is a function call;
  disposal is the registry's own disposer.
- **No authority laundering.** Steps run through the normal pipeline, so a guard, an approval,
  a sandbox or a timeout applies exactly as it would to a direct call.
- **Zero cost when unused.** No declared capability → no schema, no prompt text, no code path.

## License

MIT — see [`LICENSE`](LICENSE).
