/**
 * Test-only measurement plugin: write the model-facing tool surface to a JSON
 * file so an experiment can compare surface size without a model call.
 *
 * Facts learned while building this (all encoded here):
 *   - `tools.schemas()` resolves per SCOPE; the root view is empty when rows
 *     register into an agent scope, so the sample is taken with the agent from
 *     `agent/created`;
 *   - rows mount in sequence, and a large row (157 tools) can finish AFTER
 *     `agent/created`, so a single delayed sample is not enough — the sample is
 *     re-taken whenever `tools/change` fires, and the LAST sample is the one an
 *     experiment should read.
 *
 * Env:
 *   MEASURE_FILE      absolute path of the JSON output
 *   MEASURE_ARM       label recorded in the file
 *   MEASURE_DELAY_MS  debounce after the last tools/change (default 1500)
 */
import { writeFileSync } from 'node:fs'

const FILE = process.env.MEASURE_FILE ?? 'surface.json'
const ARM = process.env.MEASURE_ARM ?? 'unlabeled'
const DELAY = Number(process.env.MEASURE_DELAY_MS ?? 1500)

export const name = 'dsh-surface-measure'
export const inject = ['tools']

export function apply(ctx) {
  const tools = ctx.tools
  const samples = []
  let agent
  let pending

  const write = () => {
    try {
      writeFileSync(FILE, JSON.stringify({ arm: ARM, samples }, null, 1), 'utf8')
    } catch {
      /* best-effort */
    }
  }

  const sample = (stage) => {
    try {
      const schemas = tools.schemas(agent)
      const last = samples.at(-1)
      const entry = { stage, count: schemas.length, bytes: JSON.stringify(schemas).length, names: schemas.map((schema) => schema.name).sort() }
      // Keep the transcript short: one row per distinct count.
      if (!last || last.count !== entry.count || last.stage === 'agent/created') samples.push(entry)
      ctx.logger?.info?.(`surface-measure[${ARM}]: ${stage} ${entry.count} tools`)
    } catch (error) {
      samples.push({ stage, error: String((error && error.message) || error) })
    }
    write()
  }

  const schedule = (stage) => {
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(() => sample(stage), DELAY)
  }

  ctx.on('agent/created', (payload) => {
    agent = payload?.agent ?? payload
    schedule('agent/created')
  })
  ctx.on('tools/change', () => schedule('tools/change'))
}

export default { name, inject, apply }
