/**
 * Deterministic results for the pool tools — the scale experiment's ground truth.
 *
 * Values come from a local mock HTTP server (`http://127.0.0.1:8791`), which is
 * what makes the pool the only path to the answer:
 *   - the built-in `web_fetch` refuses loopback addresses (SSRF guard),
 *   - a guard plugin blocks the `pwsh` shortcut while the experiment runs.
 *
 * The `path` argument of a call selects a server endpoint, so one tool can
 * answer different questions (`git_branch repo=diverged`, `pdf_page_count
 * path=report/encrypted`). That is what lets the multi-task experiment ask
 * "does this operation's fixed pipeline cover THIS case?".
 */

const BASE = process.env.POOL_BASE_URL ?? 'http://127.0.0.1:8791'

/** Which endpoint a call should read, by tool name. */
const ROUTES = [
  [/^pdf_page_count$/, (args) => `/report${path(args.path)}`],
  [/^pdf_metadata$/, (args) => `/report${path(args.path)}`],
  [/^pdf_extract_text$/, (args) => `/report${path(args.path)}`],
  [/^pdf_layout$/, (args) => `/report${path(args.path)}`],
  [/^git_branch$/, (args) => `/repo${path(args.repo)}`],
  [/^git_log$/, (args) => `/repo${path(args.repo)}`],
  [/^git_status$/, (args) => `/repo${path(args.repo)}`],
  [/^git_diff$/, (args) => `/repo${path(args.repo)}`],
  [/^git_show$/, (args) => `/repo${path(args.repo)}`],
  [/^db_query$/, () => '/logs'],
  [/^cloud_logs$/, () => '/logs'],
  [/^cloud_metrics$/, () => '/logs'],
  [/^fs_read$/, () => '/config'],
]

/** Turn a tool argument into an endpoint path (`'diverged'` -> `/diverged`). */
function path(value) {
  const text = String(value ?? '').trim().replace(/^\/+/, '')
  return text === '' ? '' : `/${text}`
}

async function fetchJson(endpoint) {
  const response = await fetch(`${BASE}${endpoint}`)
  if (!response.ok) throw new Error(`pool upstream ${endpoint} -> ${response.status}`)
  return await response.json()
}

/**
 * The result one pool tool returns for one call.
 * @param {string} name tool name
 * @param {object} args call arguments
 * @returns {Promise<object>} a deterministic value
 */
export async function fakeResult(name, args = {}) {
  for (const [pattern, route] of ROUTES) {
    if (!pattern.test(name)) continue
    const endpoint = route(args)
    try {
      return await fetchJson(endpoint)
    } catch (error) {
      return { ok: false, error: `pool upstream unavailable: ${String((error && error.message) || error)}` }
    }
  }
  return { ok: true, note: 'no fixture value for this tool' }
}
