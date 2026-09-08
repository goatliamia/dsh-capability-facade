/**
 * Test-only guard for the scale experiment.
 *
 * The pool's ground truth is served by a loopback mock server. Two shortcuts
 * would let the model answer without using the pool:
 *   - the built-in `web_fetch` already refuses loopback (SSRF guard), so it is
 *     not a problem;
 *   - `pwsh` can reach it, which would make the pool non-essential.
 *
 * This guard denies any shell command that mentions the pool's base URL, so the
 * only path to the answer is the pool itself. It is scoped to the experiment by
 * the profile that mounts it.
 */
const BASE = process.env.POOL_BASE_URL ?? 'http://127.0.0.1:8791'

export const name = 'dsh-pool-guard'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    if (exec.name !== 'pwsh' && exec.name !== 'bash') return undefined
    const text = JSON.stringify(exec.arguments ?? {})
    if (!text.includes(BASE) && !text.includes('127.0.0.1:8791')) return undefined
    return `[pool-guard] direct shell access to the pool upstream (${BASE}) is disabled in this experiment; use the pool tools instead`
  })
}

export default { name, inject, apply }
