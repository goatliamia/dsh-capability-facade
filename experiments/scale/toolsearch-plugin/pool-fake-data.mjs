/**
 * Deterministic results for the pool tools — the scale experiment's ground truth.
 *
 * The values are served by a local mock HTTP server (`http://127.0.0.1:8791`),
 * which is what makes the pool the ONLY path to the answer:
 *   - the built-in `web_fetch` refuses loopback addresses (SSRF guard),
 *   - the `pwsh` shortcut is blocked by a tool guard while this experiment runs.
 *
 * The pool tools fetch from that server, so the numbers in a transcript prove
 * which tool produced them. If the server is unreachable the tool says so
 * instead of inventing a value.
 */

const BASE = process.env.POOL_BASE_URL ?? 'http://127.0.0.1:8791'

/** Plausible values by tool-name suffix, most specific first. */
const RULES = [
  [/^pdf_page_count$/, { endpoint: '/report', field: 'pages' }],
  [/^pdf_metadata$/, { endpoint: '/report', field: null }],
  [/^pdf_extract_text$/, { endpoint: '/report', field: null }],
  [/^pdf_layout$/, { endpoint: '/report', field: 'blocks' }],
  [/^git_branch$/, { endpoint: '/repo', field: 'branch' }],
  [/^git_log$/, { endpoint: '/repo', field: null }],
  [/^git_status$/, { endpoint: '/repo', field: null }],
  [/^git_show$/, { endpoint: '/repo', field: null }],
]

/** Static fallbacks for tools with no server mapping. */
const STATIC = {
  db_query: { rows: [{ id: 1 }], rowCount: 1 },
  db_tables: { tables: ['users', 'orders'] },
  image_info: { width: 800, height: 600, format: 'png' },
  net_status: { status: 200 },
  fs_tree: { entries: 8 },
  cloud_logs: { lines: ['INFO started', 'INFO ready'] },
}

async function fetchJson(endpoint) {
  const response = await fetch(`${BASE}${endpoint}`)
  if (!response.ok) throw new Error(`pool upstream ${endpoint} -> ${response.status}`)
  return await response.json()
}

/**
 * The result one pool tool returns for one call.
 * @param {string} name tool name
 * @returns {Promise<object>} a deterministic value
 */
export async function fakeResult(name) {
  for (const [pattern, mapping] of RULES) {
    if (!pattern.test(name)) continue
    try {
      const payload = await fetchJson(mapping.endpoint)
      return mapping.field === null ? payload : { [mapping.field]: payload[mapping.field] }
    } catch (error) {
      return { ok: false, error: `pool upstream unavailable: ${String((error && error.message) || error)}` }
    }
  }
  return STATIC[name] ?? { ok: true, note: 'no fixture value for this tool' }
}
