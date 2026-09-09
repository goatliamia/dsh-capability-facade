/**
 * Experiment arm "facade+find": an escape hatch that can be DISCOVERED.
 *
 * The exit experiment showed the failure mode of a by-name hatch: one run spent
 * 467 `pool_primitive` calls guessing primitive names, because the model had no
 * way to learn what exists. This arm gives the hatch three modes:
 *
 *   pool_primitive { mode: 'list' }                    -> every primitive name + domain
 *   pool_primitive { mode: 'search', query: '…' }      -> ranked names + exact schemas
 *   pool_primitive { mode: 'call', name, arguments }    -> run one primitive
 *
 * That is the `search → call` shape the community uses for large MCP surfaces
 * (#2588 / #2137), attached to the facade's escape path instead of replacing
 * the facade. The hypothesis: the uncovered task (T3 title) drops from
 * hundreds of guesses to a handful of calls.
 *
 * `mode` defaults to 'call' so a model that already knows the name pays nothing.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FACADE_OPERATIONS, POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-facade-find'
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

/** Lexical ranking: exact name > name prefix > domain > description. */
function search(query, limit) {
  const words = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return []
  return POOL
    .map((tool) => {
      const haystack = `${tool.name} ${tool.domain} ${tool.description}`.toLowerCase()
      let score = 0
      for (const word of words) {
        if (tool.name === word) score += 10
        if (tool.name.startsWith(`${word}_`)) score += 5
        if (tool.domain === word) score += 4
        if (haystack.includes(word)) score += 1
      }
      return { tool, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool)
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
            `If no operation covers your task, use pool_primitive with mode 'search' to find the right capability.`,
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

  ctx.tools.register(
    defineTool({
      name: 'pool_primitive',
      description:
        `Escape hatch for tasks no semantic operation covers. Modes: ` +
        `'search' (query -> ranked primitive names with exact schemas), ` +
        `'list' (all ${POOL.length} primitive names by domain), ` +
        `'call' (run one primitive by name; default).`,
      parameters: {
        mode: { type: 'string', description: "One of 'search' | 'list' | 'call' (default 'call')" },
        query: { type: 'string', description: "Keywords for mode 'search', e.g. 'title' or 'git branch'" },
        name: { type: 'string', description: "Exact primitive name for mode 'call'" },
        arguments: { type: 'object', additionalProperties: true, description: "Arguments for mode 'call'" },
        limit: { type: 'integer', description: "Max search results, 1-10 (default 5)" },
      },
      output: OUTPUT,
      async execute(args) {
        const mode = String(args.mode ?? 'call').trim().toLowerCase()
        if (mode === 'list') {
          const byDomain = {}
          for (const tool of POOL) (byDomain[tool.domain] ??= []).push(tool.name)
          return { mode: 'list', total: POOL.length, domains: byDomain }
        }
        if (mode === 'search') {
          const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10)
          const hits = search(args.query, limit)
          return {
            mode: 'search',
            query: String(args.query ?? ''),
            total: POOL.length,
            returned: hits.length,
            items: hits.map((tool) => ({ name: tool.name, domain: tool.domain, description: tool.description, parameters: tool.parameters })),
          }
        }
        return { mode: 'call', ...(await runPoolTool(String(args.name ?? '').trim(), args.arguments ?? {})) }
      },
    }),
  )

  ctx.logger?.info?.(`scale-facade-find: ${POOL.length} primitives behind ${registered} operations + discoverable hatch`)
}

export default { name, inject, apply }
