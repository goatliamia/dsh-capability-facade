/**
 * Experiment arm "raw": register the whole pool as model-facing tools.
 *
 * This is the surface a real MCP bridge produces 鈥?`dsh-mcp-client` registers
 * every remote tool under `mcp__<server>__<tool>`, one schema per tool, always
 * present. The pool's own names are kept (no prefix) so the three arms differ
 * only in surface shape, not in naming.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { POOL } from './pool-spec.mjs'
import { fakeResult } from './pool-fake-data.mjs'

export const name = 'dsh-scale-pool'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }]
  },
}

export function apply(ctx) {
  for (const tool of POOL) {
    ctx.tools.register(
      defineTool({
        name: tool.name,
        description: `${tool.description} [${tool.domain}]`,
        parameters: tool.parameters,
        output: OUTPUT,
        async execute(args) {
          return { tool: tool.name, domain: tool.domain, result: await fakeResult(tool.name, args) }
        },
      }),
    )
  }
  ctx.logger?.info?.(`scale-pool: registered ${POOL.length} model-facing tools`)
}

export default { name, inject, apply }
