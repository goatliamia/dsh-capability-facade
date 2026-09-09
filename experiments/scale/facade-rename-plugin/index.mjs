/**
 * Experiment arm "facade+rename": identical to `facade-find`, except the
 * resource-identifying parameter is named `resource` instead of `path`.
 *
 * Why this is the cheapest experiment in the series: the previous round showed
 * every arm guessing filesystem-ish values (`report.pdf`, `report.md`) instead
 * of passing the caller's id (`doc-2f8a`). The suspected cause is the parameter
 * NAME — `path` reads as a filesystem path. Renaming it costs one word.
 *
 * If the guesses disappear, then "name the parameter after the caller's
 * vocabulary" is a high-benefit, near-zero-cost authoring rule; if they do not,
 * the cause is elsewhere and the rule is not worth stating.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FACADE_OPERATIONS, POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-facade-rename'
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

/** Map the operation's `resource` input onto the primitive's own argument name. */
function stepArguments(step, operationArguments) {
  const source = operationArguments ?? {}
  if (step.from === undefined) {
    // forward the caller's resource under the name the primitive expects
    return 'resource' in source ? { path: source.resource, repo: source.resource } : source
  }
  return { [step.from]: source[step.from] }
}

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

/** Rewrite `path`/`repo` parameters in the declared operations to `resource`. */
function renamed(operation) {
  const parameters = {}
  for (const [name, spec] of Object.entries(operation.parameters ?? {})) {
    parameters[name === 'path' || name === 'repo' ? 'resource' : name] = {
      ...spec,
      description: `${spec.description ?? ''} (the caller's resource id, e.g. doc-2f8a / repo-4d07)`.trim(),
    }
  }
  return { ...operation, parameters }
}

export function apply(ctx) {
  let registered = 0
  for (const capability of FACADE_OPERATIONS) {
    for (const operation of capability.operations) {
      const renamedOperation = renamed(operation)
      const toolName = `${capability.id}_${renamedOperation.name}`
      ctx.tools.register(
        defineTool({
          name: toolName,
          description:
            `${renamedOperation.description}\n\n[capability ${capability.id}] ${capability.description}\n` +
            `Steps (run in this order, one call): ${renamedOperation.steps.map((step, index) => `${index + 1}. ${step.tool}`).join(' → ')}\n` +
            `All steps take the same resource id you were given; do not translate it into a file name.`,
          parameters: renamedOperation.parameters,
          output: OUTPUT,
          async execute(args) {
            const steps = []
            for (const step of renamedOperation.steps) steps.push(await runPoolTool(step.tool, stepArguments(step, args)))
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
      description: `Escape hatch: 'search' (ranked names + schemas), 'list' (all names), 'call' (run by name; default). Resource-identifying arguments use the caller's id.`,
      parameters: {
        mode: { type: 'string', description: "One of 'search' | 'list' | 'call' (default 'call')" },
        query: { type: 'string', description: "Keywords for mode 'search'" },
        name: { type: 'string', description: "Exact primitive name for mode 'call'" },
        arguments: { type: 'object', additionalProperties: true, description: "Arguments for mode 'call'" },
        limit: { type: 'integer', description: 'Max search results, 1-10 (default 5)' },
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
          return { mode: 'search', query: String(args.query ?? ''), total: POOL.length, returned: hits.length, items: hits.map((tool) => ({ name: tool.name, domain: tool.domain, description: tool.description, parameters: tool.parameters })) }
        }
        return { mode: 'call', ...(await runPoolTool(String(args.name ?? '').trim(), args.arguments ?? {})) }
      },
    }),
  )

  ctx.logger?.info?.(`scale-facade-rename: ${POOL.length} primitives behind ${registered} operations, resource-named parameters + discoverable hatch`)
}

export default { name, inject, apply }
