/**
 * Experiment arm "facade+signal": operations that say when they do NOT cover a task.
 *
 * The exit experiment showed that an escape hatch turns "no solution" into "a
 * solution" but the model only reaches it late: it tries every operation first.
 * The reason is that an operation that cannot answer a task returns an empty or
 * partial result, which reads like "the data is missing" rather than "this
 * operation is the wrong tool".
 *
 * This arm adds the missing signal. Each operation declares, per step, which
 * fields it expects. After running the pipeline it reports:
 *
 *   covered: true                  -> the answer is here
 *   covered: false + reason        -> THIS OPERATION DOES NOT COVER THE TASK,
 *                                     try another operation or the escape hatch
 *
 * The signal is deterministic and author-declared; the model does not have to
 * infer "not covered" from an empty payload.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FACADE_OPERATIONS, POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-facade-signal'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

const byName = new Map(POOL.map((tool) => [tool.name, tool]))

/** Fields a step is expected to return; a missing field means "not covered". */
const STEP_EXPECTS = {
  pdf_metadata: ['title', 'pages'],
  pdf_page_count: ['pages'],
  pdf_extract_text: ['text'],
  pdf_layout: ['blocks'],
  git_status: ['branch', 'clean'],
  git_log: ['commits'],
  git_diff: ['files'],
  cloud_logs: ['lines', 'errors'],
  cloud_metrics: ['cpu'],
  db_tables: ['tables'],
  db_schema: ['columns'],
  db_indexes: ['indexes'],
  image_info: ['width'],
  image_metadata: ['camera'],
  image_palette: ['colors'],
  net_headers: ['status'],
  browser_snapshot: ['nodes'],
  fs_tree: ['entries'],
  fs_disk_usage: ['bytes'],
  fs_grep: ['matches'],
}

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

/** Which expected fields a step's result actually carries. */
function missingFields(tool, result) {
  const expects = STEP_EXPECTS[tool]
  if (expects === undefined || result === null || typeof result !== 'object') return []
  return expects.filter((field) => !(field in result))
}

export function apply(ctx) {
  let registered = 0
  for (const capability of FACADE_OPERATIONS) {
    for (const operation of capability.operations) {
      const toolName = `${capability.id}_${operation.name}`
      ctx.tools.register(
        defineTool({
          name: toolName,
          description:
            `${operation.description}\n\n[capability ${capability.id}] ${capability.description}\n` +
            `Steps (run in this order, one call): ${operation.steps.map((step, index) => `${index + 1}. ${step.tool}`).join(' → ')}\n` +
            `If this operation reports covered=false, it does NOT cover your task: use another operation or pool_primitive.`,
          parameters: operation.parameters ?? {},
          output: OUTPUT,
          async execute(args) {
            const steps = []
            for (const step of operation.steps) {
              const outcome = await runPoolTool(step.tool, stepArguments(step, args))
              steps.push({ ...outcome, missing: outcome.ok ? missingFields(step.tool, outcome.result) : [] })
            }
            const failed = steps.find((step) => step.ok === false)
            const missing = steps.flatMap((step) => step.missing.map((field) => `${step.tool}.${field}`))
            if (failed !== undefined) {
              return { covered: false, reason: `step ${failed.tool} failed: ${failed.error}`, capability: capability.id, operation: operation.name, steps }
            }
            if (missing.length > 0) {
              return {
                covered: false,
                reason: `this operation does not carry the fields ${missing.join(', ')}`,
                hint: 'try another semantic operation, or pool_primitive for a specific capability',
                capability: capability.id,
                operation: operation.name,
                steps,
              }
            }
            return { covered: true, capability: capability.id, operation: operation.name, steps }
          },
        }),
      )
      registered += 1
    }
  }

  ctx.tools.register(
    defineTool({
      name: 'pool_primitive',
      description: `Escape hatch: runs one of the ${POOL.length} underlying capabilities by exact name. Use when a semantic operation reports covered=false.`,
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

  ctx.logger?.info?.(`scale-facade-signal: ${POOL.length} primitives behind ${registered} operations + coverage signal + escape hatch`)
}

export default { name, inject, apply }
