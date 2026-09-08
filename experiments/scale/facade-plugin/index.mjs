/**
 * Experiment arm "facade": semantic operations only, primitives never registered.
 *
 * The pool's behavior is identical to the other arms (every step returns the
 * same `{ tool, domain, got }` shape), but the primitives stay plain functions.
 * That is forced by a measured constraint: the facade's operations dispatch
 * through `ctx.tools.execute()`, so any step tool that exists is also a
 * model-facing tool. The only way to have a narrow surface is to never register
 * the primitives 闁?see docs/constraint-restrict-vs-nested-dispatch.md.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FACADE_OPERATIONS, POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-facade'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

const byName = new Map(POOL.map((tool) => [tool.name, tool]))

/** The pool's implementation 闁?a plain function, never a registered tool. */
async function runPoolTool(name, args) {
  const tool = byName.get(name)
  if (tool === undefined) return { ok: false, tool: name, error: `unknown pool tool "${name}"` }
  return { ok: true, tool: name, domain: tool.domain, result: await fakeResult(name, args ?? {}) }
}

/** Resolve one step's arguments from the operation input (`from` picks a field). */
function stepArguments(step, operationArguments) {
  const source = operationArguments ?? {}
  if (step.from === undefined) return source
  const value = source[step.from]
  return value !== null && typeof value === 'object' ? value : {}
}

export function apply(ctx) {
  let registered = 0
  for (const capability of FACADE_OPERATIONS) {
    for (const operation of capability.operations) {
      const toolName = `${capability.id}_${operation.name}`
      ctx.tools.register(
        defineTool({
          name: toolName,
          description: `${operation.description}\n\n[capability ${capability.id}] ${capability.description}\nSteps (run in this order, one call): ${operation.steps
            .map((step, index) => `${index + 1}. ${step.tool}`)
            .join(' 闁?')}`,
          parameters: operation.parameters ?? {},
          output: OUTPUT,
          async execute(args) {
            const steps = []; for (const step of operation.steps) { steps.push(await runPoolTool(step.tool, stepArguments(step, args))) }
            return { ok: steps.every((step) => step.ok), capability: capability.id, operation: operation.name, steps }
          },
        }),
      )
      registered += 1
    }
  }
  ctx.logger?.info?.(`scale-facade: ${POOL.length} internal pool tools behind ${registered} semantic operations`)
}

export default { name, inject, apply }
