/**
 * Experiment arm "facade+exit": semantic operations PLUS an explicit escape hatch.
 *
 * The plain facade arm (`facade-plugin/`) keeps every primitive internal, which
 * makes a closed world: when a task is not covered by a declared operation the
 * model has nothing to fall back to and burns calls trying operations that
 * cannot answer it.
 *
 * This arm keeps the same 15 operations and adds exactly ONE extra model-facing
 * tool, `pool_primitive`, which runs any primitive by name. That is the
 * "natural exit" the design principles call for:
 *
 *   covered task      -> one semantic operation
 *   uncovered task    -> one escape-hatch call, no closed world
 *
 * The escape hatch is a deliberate, bounded widening of the surface (+1 tool),
 * not a return to the raw 157.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FACADE_OPERATIONS, POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-facade-exit'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

const byName = new Map(POOL.map((tool) => [tool.name, tool]))

async function runPoolTool(name, args) {
  const tool = byName.get(name)
  if (tool === undefined) return { ok: false, tool: name, error: `unknown pool tool "${name}"` }
  return { ok: true, tool: name, domain: tool.domain, result: await fakeResult(name, args ?? {}) }
}

function stepArguments(step, operationArguments) {
  const source = operationArguments ?? {}
  if (step.from === undefined) return source
  return { [step.from]: source[step.from] }
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
            .join(' → ')}\nIf no operation covers your task, use pool_primitive to reach a specific capability instead.`,
          parameters: operation.parameters ?? {},
          output: OUTPUT,
          async execute(args) {
            const steps = []
            for (const step of operation.steps) steps.push(await runPoolTool(step.tool, stepArguments(step, args)))
            return { ok: steps.every((step) => step.ok), capability: capability.id, operation: operation.name, steps }
          },
        }),
      )
      registered += 1
    }
  }

  // The escape hatch: one tool that reaches every primitive by name.
  ctx.tools.register(
    defineTool({
      name: 'pool_primitive',
      description:
        `Escape hatch for tasks no semantic operation covers. Runs one of the ${POOL.length} underlying capabilities by exact name. ` +
        `Prefer a semantic operation when one fits; use this only when none does.`,
      parameters: {
        name: { type: 'string', required: true, description: 'Exact primitive name, e.g. git_branch, pdf_page_count, cloud_logs' },
        arguments: { type: 'object', additionalProperties: true, description: 'Arguments for that primitive' },
      },
      output: OUTPUT,
      async execute(args) {
        return await runPoolTool(String(args.name ?? '').trim(), args.arguments ?? {})
      },
    }),
  )

  ctx.logger?.info?.(`scale-facade-exit: ${POOL.length} primitives behind ${registered} operations + 1 escape hatch`)
}

export default { name, inject, apply }
