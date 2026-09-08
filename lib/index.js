/**
 * dsh-capability-facade — a Model Capability Facade for DSH.
 *
 * The problem it solves is a surface problem, not a governance problem. A
 * plugin that has fifteen internal operations usually registers fifteen
 * model-facing tools, so the model's world becomes "the tool list" and its job
 * becomes picking the right primitive and ordering the primitives itself.
 *
 * DSH already keeps its own capability seams narrow: a model talks to
 * `ctx.fs`, `ctx.shell`, or `ctx.llm` through a designed interface, never
 * through the provider's implementation. This plugin applies the same idea one
 * layer lower: a plugin declares ONE capability (a few semantic operations),
 * and the facade turns each operation into one model-facing tool that runs a
 * declared, deterministic pipeline of existing tools.
 *
 *   implementation tools            model-facing surface
 *   pdf.extract ─┐
 *   pdf.layout  ─┼─ pipeline ──▶   pdf_analyze
 *   pdf.ocr     ─┘                 pdf_modify
 *
 * Three properties are deliberate and evidence-backed (see README + tests):
 *
 *   1. Nested dispatch, never a side door. Every step runs through
 *      `ctx.tools.execute()` with the caller's agent and `parent: exec.token`,
 *      so guards, `tools/pre-execute`, approvals, around-dispatch wrappers,
 *      post-execute, cancellation, and result materialization all still apply
 *      to the underlying tool. The facade adds a name and an order; it does
 *      not add authority.
 *
 *   2. Explicit, fail-loud registration. A capability names the tools it will
 *      call, and registration refuses unknown or restricted-away names. A
 *      half-wired facade would silently fail at call time, which is worse than
 *      refusing at mount time.
 *
 *   3. Zero cost when undeclared. This row registers no tool by itself. Cost
 *      appears only where an author (or a user, through settings) actually
 *      declares a capability.
 *
 * The facade does NOT hide the underlying tools. DSH resolves nested dispatch
 * through the same scoped visibility as the model's view, so `restrict()`ing a
 * tool makes it unreachable for the facade too (verified: see
 * docs/constraint-restrict-vs-nested-dispatch.md). A capability therefore
 * *reduces* the surface only when the plugin author does not register the
 * implementation tools as model-facing in the first place — which is the
 * arrangement this facade is designed for.
 *
 * @module dsh-capability-facade
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Capability id: the first segment of every generated operation tool name. */
const ID_PATTERN = /^[a-z][a-z0-9_]*$/
/** Tool name pattern: what the registry accepts AND what every model provider accepts. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/
/** Model-facing text budget for one step's value inside the facade result. */
const STEP_TEXT_BUDGET = 2000
/** Model-facing text budget for one error message inside the facade result. */
const ERROR_TEXT_BUDGET = 600

/** Build a plain `{ ok: false, error }` value; never throws at call time. */
const fail = (error) => ({ ok: false, error: String((error && error.message) || error) })

const clip = (text, max) => {
  const value = String(text === undefined || text === null ? '' : text)
  return value.length <= max ? value : `${value.slice(0, max)}…[+truncated]`
}

/** Model-facing text for one step value: the tool's own content when it has any. */
function stepText(result) {
  const parts = []
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
  }
  if (parts.length > 0) return clip(parts.join('\n'), STEP_TEXT_BUDGET)
  const value = result.value
  if (value === undefined) return '(no value)'
  try {
    return clip(JSON.stringify(value), STEP_TEXT_BUDGET)
  } catch {
    return '(value is not JSON-serializable)'
  }
}

/** Copy the lossless-JSON `value` out of a settled tool result. */
function stepValue(result) {
  const value = result.value
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

/**
 * Resolve one step's arguments from the operation's own arguments.
 * A step either takes the whole operation input, or reads one named field from
 * it (`from`). A missing field is a wiring bug and is reported as such.
 * @returns `{ ok: true, args }` or `{ ok: false, error }`.
 */
function stepArguments(step, operationArguments) {
  if (step.from === undefined) return { ok: true, args: operationArguments }
  const source = operationArguments
  if (source === null || typeof source !== 'object') {
    return { ok: false, error: `operation input is not an object; step "${step.tool}" needs field "${step.from}"` }
  }
  if (!(step.from in source)) {
    return { ok: false, error: `operation input has no field "${step.from}" required by step "${step.tool}"` }
  }
  const value = source[step.from]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `operation input field "${step.from}" must be an object for step "${step.tool}"` }
  }
  return { ok: true, args: value }
}

/**
 * Validate one capability declaration and resolve every referenced tool.
 * @param {(name: string) => object | undefined} resolveStep - how a step name
 *   becomes a dispatchable definition (the tool registry, or the facade's own
 *   internal registry for tools it registered itself).
 * @throws {Error} with an actionable message; registration is fail-loud.
 */
function validateCapability(capability, resolveStep) {
  if (capability === null || typeof capability !== 'object') throw new Error('capability must be an object')
  const { id, description, operations } = capability
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`capability id "${String(id)}" must match ${String(ID_PATTERN)}`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`capability "${id}" needs a non-empty description: it is the only text the model reads before choosing`)
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error(`capability "${id}" needs a non-empty operations array`)
  }

  const names = new Set()
  const resolved = []
  for (const operation of operations) {
    if (operation === null || typeof operation !== 'object') {
      throw new Error(`capability "${id}": every operation must be an object`)
    }
    const { name, description: operationDescription, parameters, steps } = operation
    if (typeof name !== 'string' || !ID_PATTERN.test(name)) {
      throw new Error(`capability "${id}": operation name "${String(name)}" must match ${String(ID_PATTERN)}`)
    }
    const toolName = `${id}_${name}`
    if (!TOOL_NAME_PATTERN.test(toolName)) throw new Error(`capability "${id}": generated tool name "${toolName}" is invalid`)
    if (names.has(toolName)) throw new Error(`capability "${id}": duplicate operation tool "${toolName}"`)
    names.add(toolName)
    if (typeof operationDescription !== 'string' || operationDescription.trim() === '') {
      throw new Error(`capability "${id}.${name}" needs a non-empty description`)
    }
    if (parameters !== undefined && (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters))) {
      throw new Error(`capability "${id}.${name}": parameters must be a parameter-spec object`)
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error(`capability "${id}.${name}" needs a non-empty steps array`)
    }

    const resolvedSteps = steps.map((step, index) => {
      if (step === null || typeof step !== 'object') {
        throw new Error(`capability "${id}.${name}" step ${index + 1} must be an object`)
      }
      const { tool, from } = step
      if (typeof tool !== 'string' || !TOOL_NAME_PATTERN.test(tool)) {
        throw new Error(`capability "${id}.${name}" step ${index + 1}: tool "${String(tool)}" is not a valid tool name`)
      }
      if (from !== undefined && (typeof from !== 'string' || !ID_PATTERN.test(from))) {
        throw new Error(`capability "${id}.${name}" step ${index + 1}: from "${String(from)}" must be a field name`)
      }
      // Fail loud now: an unknown or restricted-away tool can never be
      // dispatched, and finding that out mid-pipeline wastes a model turn.
      const definition = resolveStep(tool)
      if (definition === undefined) {
        throw new Error(
          `capability "${id}.${name}" step ${index + 1}: tool "${tool}" is not registered (or is restricted away). ` +
            `Register the tool first, then the capability.`,
        )
      }
      return { tool, ...(from !== undefined ? { from } : {}) }
    })
    resolved.push({ name, description: operationDescription, parameters: parameters ?? {}, steps: resolvedSteps })
  }

  return { id, description, operations: resolved }
}

/**
 * Build the capability facade service object. Other plugins read it with
 * `ctx.get('capabilities')` and declare capabilities through it.
 *
 * Two authoring styles, same execution path:
 *
 *   - `register({ id, description, operations })` — declare a semantic
 *     capability over tools that already exist in the registry.
 *
 * The facade does NOT hide anything. DSH's registry documents one visibility
 * resolver feeding presentation, lookup, and dispatch, so a tool hidden from
 * the model is also unreachable for a nested dispatch (verified: harness tests
 * 9 and 10, and the headless experiment in `experiment/`). A facade therefore
 * narrows the model's surface only when the plugin author never registers the
 * implementation tools as model-facing in the first place.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function createFacade(ctx) {
  const registered = new Map()

  return {
    registered,

    /**
     * Declare one capability and register its model-facing operation tools.
     *
     * Registration is all-or-nothing: a declaration that names an unknown tool,
     * repeats an operation, or carries an invalid field registers nothing.
     * The returned disposer unregisters every tool the capability added; the
     * Cordis fiber also owns them, so plugin unload removes them automatically.
     *
     * @param {object} capability - `{ id, description, operations }`.
     * @param {{ scope?: import('@deepseek-ai/cordis').Context, agent?: unknown }} [options] -
     *   `scope` registers the operation tools through that (agent) context;
     *   `agent` is the scope key a step name resolves against (pass it whenever
     *   the steps live in the same agent scope, because a scope's own
     *   registrations are not part of that scope's view).
     * @returns {() => void} the exact disposer that withdraws the capability.
     */
    register(capability, options = {}) {
      const scope = options.scope ?? ctx
      const agent = options.agent
      const validated = validateCapability(capability, (name) => (agent !== undefined ? scope.tools.get(name, agent) : scope.tools.get(name)))
      const { id } = validated
      if (registered.has(id)) throw new Error(`capability "${id}" is already registered`)

      const disposers = []
      try {
        for (const operation of validated.operations) {
          const toolName = `${id}_${operation.name}`
          const description = `${operation.description}\n\n[capability ${id}] ${validated.description}\nSteps (run in this order by the harness, one call): ${operation.steps
            .map((step, index) => `${index + 1}. ${step.tool}`)
            .join(' → ')}`

          const tool = defineTool({
            name: toolName,
            description,
            parameters: operation.parameters,
            output: {
              schema: { type: 'object', additionalProperties: true },
              render(_args, value) {
                const text = value && typeof value.text === 'string' ? value.text : JSON.stringify(value)
                return [{ type: 'text', text }]
              },
            },
            async execute(args, exec) {
              const results = []
              for (let index = 0; index < operation.steps.length; index += 1) {
                const step = operation.steps[index]
                const resolved = stepArguments(step, args)
                if (!resolved.ok) {
                  results.push({ tool: step.tool, ok: false, error: resolved.error })
                  break
                }
                // A nested dispatch, not a private call: the underlying tool keeps
                // its own guard, approval, timeout, and result contract.
                const outcome = await scope.tools.execute({
                  callId: `${exec.callId}:${id}.${operation.name}:${index + 1}`,
                  rootCallId: exec.rootCallId,
                  name: step.tool,
                  arguments: resolved.args,
                  ...(exec.agent !== undefined ? { agent: exec.agent } : {}),
                  parent: exec.token,
                  signal: exec.signal,
                })
                if (outcome.isError) {
                  results.push({
                    tool: step.tool,
                    ok: false,
                    error: clip(outcome.error && outcome.error.message, ERROR_TEXT_BUDGET),
                    ...(outcome.error && outcome.error.info ? { code: outcome.error.info.code } : {}),
                  })
                  break
                }
                results.push({ tool: step.tool, ok: true, text: stepText(outcome), value: stepValue(outcome) })
              }
              const failed = results.find((result) => result.ok === false)
              return {
                ok: failed === undefined,
                capability: id,
                operation: operation.name,
                steps: results,
                ...(failed !== undefined ? { failedStep: failed.tool, error: failed.error } : {}),
              }
            },
          })

          disposers.push(scope.tools.register(tool))
        }
      } catch (error) {
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {
            /* the registry already withdrew it */
          }
        }
        throw error
      }

      registered.set(id, {
        id,
        description: validated.description,
        tools: validated.operations.map((operation) => `${id}_${operation.name}`),
      })
      let live = true
      return () => {
        if (!live) return
        live = false
        for (const dispose of disposers.reverse()) dispose()
        registered.delete(id)
      }
    },

    /**
     * Declarative listing of what is currently exposed — for other plugins, a
     * settings page, or a diagnostic tool. Deliberately not a model-facing tool:
     * an operation list the model already sees as schemas does not need a second
     * surface.
     * @returns {Array<{ id: string, description: string, tools: string[] }>}
     */
    list() {
      return [...registered.values()].map((entry) => ({ id: entry.id, description: entry.description, tools: [...entry.tools] }))
    },
  }
}

export const name = 'dsh-capability-facade'
/** Hard dependency: without the tool registry a facade cannot dispatch. */
export const inject = ['tools']

/**
 * Mount the facade. `ctx.capabilities` is available to every plugin that
 * mounts after this row, and `register()` can be called at any time.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.provide('capabilities', createFacade(ctx))
}

export default { name, inject, apply }
