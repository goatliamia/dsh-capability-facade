/**
 * Test-only audit plugin: append every settled tool call to a JSONL file.
 *
 * The `tools/result` event is the registry's final observation point — it fires
 * once per call, including nested dispatches, which is exactly what an A/B over
 * model behavior needs: a durable list of what was called, in order.
 *
 * Env:
 *   AUDIT_FILE  absolute path of the JSONL file (default: ./calls.jsonl)
 *   AUDIT_ARM   free-form label recorded on every line
 */
import { appendFileSync } from 'node:fs'

const FILE = process.env.AUDIT_FILE ?? 'calls.jsonl'
const ARM = process.env.AUDIT_ARM ?? 'unlabeled'

function record(entry) {
  try {
    appendFileSync(FILE, `${JSON.stringify({ arm: ARM, ...entry })}\n`, 'utf8')
  } catch {
    /* audit is best-effort; never break a run for it */
  }
}

export const name = 'dsh-call-audit'
export const inject = ['tools']

export function apply(ctx) {
  record({ event: 'mount' })
  ctx.on('tools/result', (exec, result) => {
    record({
      event: 'call',
      tool: String(exec?.name ?? ''),
      nested: exec?.parent !== undefined,
      callId: exec?.callId === undefined ? null : String(exec.callId),
      isError: result?.isError === true,
      rootCallId: exec?.rootCallId === undefined ? null : String(exec.rootCallId),
    })
  })
}

export default { name, inject, apply }
