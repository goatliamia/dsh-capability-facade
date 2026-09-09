/**
 * Test-only token measurement plugin.
 *
 * Two different costs are measured, each with the right instrument:
 *
 *   toolSchemaBytes   the model-facing tool schema — a FIXED per-request cost.
 *                     Priced as bytes/4 (the same rough heuristic the earlier
 *                     scale report used) because it is a prompt-header cost the
 *                     session meter does not fold.
 *   surfaceTokens     the session surface (messages + tool results) — measured
 *                     with the AUTHORITATIVE `ctx.tokenMeter.measure(session)`,
 *                     which is replay-priced and provider-aware.
 *
 * Env:
 *   TOKEN_FILE   absolute path of the JSON output
 *   TOKEN_ARM    label recorded in the file
 */
import { writeFileSync } from 'node:fs'

const FILE = process.env.TOKEN_FILE ?? 'tokens.json'
const ARM = process.env.TOKEN_ARM ?? 'unlabeled'

export const name = 'dsh-token-measure'
export const inject = ['tools', 'tokenMeter']

export function apply(ctx) {
  const tools = ctx.tools
  const meter = ctx.tokenMeter

  ctx.on('agent/created', ({ agent }) => {
    setTimeout(() => {
      try {
        const schemas = tools.schemas(agent)
        const schemaBytes = JSON.stringify(schemas).length
        const measurement = agent?.session === undefined ? undefined : meter.measure(agent.session)
        const payload = {
          arm: ARM,
          toolCount: schemas.length,
          toolSchemaBytes: schemaBytes,
          toolSchemaTokensApprox: Math.round(schemaBytes / 4),
          surfaceTokens: measurement?.surfaceTokens ?? null,
          totalTokens: measurement?.totalTokens ?? null,
          surfaceDeltaTokens: measurement?.surfaceDeltaTokens ?? null,
          logRevision: measurement?.logRevision ?? null,
          nodeCount: measurement?.nodes?.length ?? null,
        }
        writeFileSync(FILE, JSON.stringify(payload, null, 1), 'utf8')
        ctx.logger?.info?.(`token-measure[${ARM}]: tools=${payload.toolCount} schemaBytes=${schemaBytes} surfaceTokens=${payload.surfaceTokens}`)
      } catch (error) {
        try {
          writeFileSync(FILE, JSON.stringify({ arm: ARM, error: String((error && error.message) || error) }, null, 1), 'utf8')
        } catch { /* best-effort */ }
      }
    }, 2500)
  })
}

export default { name, inject, apply }
