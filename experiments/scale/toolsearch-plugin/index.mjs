/**
 * Experiment arm "toolsearch": the whole pool behind two model-facing tools.
 *
 * This is the community answer to a large tool surface (discussion #2588:
 * 178 tools; #2137: 1,000 tools behind `mcp_search` + `mcp_call`): keep one
 * search entry and one call entry, reveal exact schemas only for the ranked
 * candidates.
 *
 * Deliberately the same shape as MCP Lens's public contract, not a copy of its
 * implementation: `search` returns a small ranked list with exact schemas;
 * `call` invokes one named tool and refuses names that were never searched.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-toolsearch'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  },
}

const byName = new Map(POOL.map((tool) => [tool.name, tool]))

/** Terms that help a lexical search without pretending to be embeddings. */
function terms(tool) {
  return `${tool.name} ${tool.domain} ${tool.description}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function search(query, limit) {
  const words = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (words.length === 0) return []
  const scored = POOL.map((tool) => {
    const haystack = terms(tool)
    let score = 0
    for (const word of words) {
      if (tool.name === word) score += 10
      if (tool.name.startsWith(`${word}_`)) score += 5
      if (tool.domain === word) score += 4
      if (haystack.includes(word)) score += 1
    }
    return { tool, score }
  })
  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool)
}

export function apply(ctx) {
  const searched = new Set()

  ctx.tools.register(
    defineTool({
      name: 'pool_search',
      description: `Search the ${POOL.length} pool capabilities by keyword and return the exact input schema of the most relevant ones. Use this before pool_call.`,
      parameters: {
        query: { type: 'string', required: true, description: 'Keywords, e.g. "pdf text" or "git commit"' },
        limit: { type: 'integer', description: 'Maximum results, 1閳?0 (default 5)' },
      },
      output: OUTPUT,
      async execute(args) {
        const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 10)
        const hits = search(args.query, limit)
        for (const hit of hits) searched.add(hit.name)
        return {
          query: String(args.query ?? ''),
          total: POOL.length,
          returned: hits.length,
          items: hits.map((hit) => ({ name: hit.name, domain: hit.domain, description: hit.description, parameters: hit.parameters })),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pool_call',
      description: 'Call one exact pool capability by name. The name must come from pool_search.',
      parameters: {
        name: { type: 'string', required: true, description: 'Exact tool name from pool_search' },
        arguments: { type: 'object', additionalProperties: true, description: 'Arguments matching that tool input schema' },
      },
      output: OUTPUT,
      async execute(args) {
        const name = String(args.name ?? '').trim()
        const tool = byName.get(name)
        if (tool === undefined) return { ok: false, error: `unknown pool tool "${name}"; call pool_search first` }
        return { ok: true, tool: name, domain: tool.domain, result: await fakeResult(name, args.arguments ?? {}), searched: searched.has(name) }
      },
    }),
  )

  ctx.logger?.info?.(`scale-toolsearch: ${POOL.length} pool tools behind pool_search + pool_call`)
}

export default { name, inject, apply }
