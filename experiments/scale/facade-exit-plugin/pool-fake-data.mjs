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

/**
 * Resource id -> endpoint. The pool's ids are deliberately NOT filename-like
 * (`doc-2f8a`, `repo-9c1e`): an earlier version used `report` / `locked`, and
 * every arm kept treating them as filesystem paths (`report.pdf`, `report.md`),
 * which turned a design question into an experiment artifact.
 */
const ENDPOINTS = {
  'doc-2f8a': { group: 'report', suffix: '' },
  'doc-7b31': { group: 'report', suffix: '/locked' },
  'repo-9c1e': { group: 'repo', suffix: '' },
  'repo-4d07': { group: 'repo', suffix: '/diverged' },
}

function endpointFor(group, id) {
  const key = String(id ?? '').trim().toLowerCase()
  const known = ENDPOINTS[key]
  if (known !== undefined && known.group === group) return `/${group}${known.suffix}`
  return key === '' || key === group ? `/${group}` : `/${group}/${key}`
}

/** Which endpoint a call should read, by tool name. */
const ROUTES = [
  [/^pdf_page_count$/, (args) => endpointFor('report', args.path)],
  [/^pdf_metadata$/, (args) => endpointFor('report', args.path)],
  [/^pdf_extract_text$/, (args) => endpointFor('report', args.path)],
  [/^pdf_layout$/, (args) => endpointFor('report', args.path)],
  [/^git_branch$/, (args) => endpointFor('repo', args.repo)],
  [/^git_log$/, (args) => endpointFor('repo', args.repo)],
  [/^git_status$/, (args) => endpointFor('repo', args.repo)],
  [/^git_diff$/, (args) => endpointFor('repo', args.repo)],
  [/^git_show$/, (args) => endpointFor('repo', args.repo)],
  [/^db_query$/, () => '/logs'],
  [/^cloud_logs$/, () => '/logs'],
  [/^cloud_metrics$/, () => '/logs'],
  [/^fs_read$/, () => '/config'],
]

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
