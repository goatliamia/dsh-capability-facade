/**
 * The tool pool for the scale experiment: a realistic large surface.
 *
 * Shape is taken from the community reports this experiment answers — a big MCP
 * server exposing 100+ tools (discussion #2588: 178 tools; #2137: 1,000 tools).
 * The names and parameters follow real plugin/MCP conventions (`domain_verb`),
 * and every tool is deterministic and side-effect free: the experiment measures
 * the MODEL-FACING SURFACE, not what the tools do.
 *
 * Domains are deliberately uneven, like a real server: some hold one obvious
 * pipeline, some are flat long tails.
 */

/** One entry: [name, description, parameters]. */
const SPEC = {
  git: [
    ['git_status', 'Show the working tree status.', { repo: { type: 'string', required: true } }],
    ['git_diff', 'Show changes between commits, commits and working tree, etc.', { repo: { type: 'string', required: true }, ref: { type: 'string' } }],
    ['git_log', 'Show commit logs.', { repo: { type: 'string', required: true }, limit: { type: 'integer' } }],
    ['git_show', 'Show a commit, tag or tree object.', { repo: { type: 'string', required: true }, object: { type: 'string', required: true } }],
    ['git_blame', 'Show what revision and author last modified each line.', { repo: { type: 'string', required: true }, file: { type: 'string', required: true } }],
    ['git_branch', 'List, create or delete branches.', { repo: { type: 'string', required: true }, name: { type: 'string' } }],
    ['git_checkout', 'Switch branches or restore working tree files.', { repo: { type: 'string', required: true }, target: { type: 'string', required: true } }],
    ['git_commit', 'Record changes to the repository.', { repo: { type: 'string', required: true }, message: { type: 'string', required: true } }],
    ['git_add', 'Add file contents to the index.', { repo: { type: 'string', required: true }, paths: { type: 'array', items: { type: 'string' } } }],
    ['git_reset', 'Reset current HEAD to the specified state.', { repo: { type: 'string', required: true }, target: { type: 'string' } }],
    ['git_stash', 'Stash the changes in a dirty working directory.', { repo: { type: 'string', required: true } }],
    ['git_merge', 'Join two or more development histories together.', { repo: { type: 'string', required: true }, branch: { type: 'string', required: true } }],
    ['git_rebase', 'Reapply commits on top of another base tip.', { repo: { type: 'string', required: true }, onto: { type: 'string', required: true } }],
    ['git_tag', 'Create, list, delete or verify tags.', { repo: { type: 'string', required: true }, name: { type: 'string' } }],
    ['git_remote', 'Manage the set of tracked repositories.', { repo: { type: 'string', required: true } }],
    ['git_fetch', 'Download objects and refs from another repository.', { repo: { type: 'string', required: true } }],
    ['git_push', 'Update remote refs along with associated objects.', { repo: { type: 'string', required: true } }],
    ['git_pull', 'Fetch from and integrate with another repository.', { repo: { type: 'string', required: true } }],
    ['git_cherry_pick', 'Apply the changes introduced by some existing commits.', { repo: { type: 'string', required: true }, commit: { type: 'string', required: true } }],
    ['git_revert', 'Revert some existing commits.', { repo: { type: 'string', required: true }, commit: { type: 'string', required: true } }],
  ],
  browser: [
    ['browser_open', 'Open a URL in a new page.', { url: { type: 'string', required: true } }],
    ['browser_close', 'Close the current page.', { tab: { type: 'string' } }],
    ['browser_navigate', 'Navigate the current page to a URL.', { url: { type: 'string', required: true } }],
    ['browser_reload', 'Reload the current page.', {}],
    ['browser_go_back', 'Go back in history.', {}],
    ['browser_go_forward', 'Go forward in history.', {}],
    ['browser_click', 'Click an element matched by selector.', { selector: { type: 'string', required: true } }],
    ['browser_type', 'Type text into an input matched by selector.', { selector: { type: 'string', required: true }, text: { type: 'string', required: true } }],
    ['browser_hover', 'Hover an element.', { selector: { type: 'string', required: true } }],
    ['browser_scroll', 'Scroll the page or an element.', { selector: { type: 'string' }, deltaY: { type: 'integer' } }],
    ['browser_press', 'Press a keyboard key.', { key: { type: 'string', required: true } }],
    ['browser_select_option', 'Select an option in a select element.', { selector: { type: 'string', required: true }, value: { type: 'string', required: true } }],
    ['browser_wait_for', 'Wait until a selector or text appears.', { selector: { type: 'string' }, text: { type: 'string' }, timeoutMs: { type: 'integer' } }],
    ['browser_screenshot', 'Capture a screenshot of the page.', { fullPage: { type: 'boolean' } }],
    ['browser_snapshot', 'Return the accessibility snapshot of the page.', {}],
    ['browser_eval', 'Evaluate JavaScript in the page.', { expression: { type: 'string', required: true } }],
    ['browser_get_text', 'Return the text content of an element.', { selector: { type: 'string', required: true } }],
    ['browser_get_attribute', 'Return an attribute of an element.', { selector: { type: 'string', required: true }, name: { type: 'string', required: true } }],
    ['browser_set_viewport', 'Resize the viewport.', { width: { type: 'integer', required: true }, height: { type: 'integer', required: true } }],
    ['browser_cookies', 'Read or write cookies.', { action: { type: 'string', required: true } }],
    ['browser_network', 'List recent network requests.', { limit: { type: 'integer' } }],
    ['browser_console', 'Return console messages.', { level: { type: 'string' } }],
  ],
  db: [
    ['db_connect', 'Open a database connection.', { url: { type: 'string', required: true } }],
    ['db_disconnect', 'Close a database connection.', { id: { type: 'string', required: true } }],
    ['db_query', 'Run a read query and return rows.', { id: { type: 'string', required: true }, sql: { type: 'string', required: true } }],
    ['db_execute', 'Run a write statement and return affected rows.', { id: { type: 'string', required: true }, sql: { type: 'string', required: true } }],
    ['db_transaction_begin', 'Begin a transaction.', { id: { type: 'string', required: true } }],
    ['db_transaction_commit', 'Commit the current transaction.', { id: { type: 'string', required: true } }],
    ['db_transaction_rollback', 'Roll back the current transaction.', { id: { type: 'string', required: true } }],
    ['db_tables', 'List tables in the current schema.', { id: { type: 'string', required: true } }],
    ['db_schema', 'Describe a table.', { id: { type: 'string', required: true }, table: { type: 'string', required: true } }],
    ['db_indexes', 'List indexes of a table.', { id: { type: 'string', required: true }, table: { type: 'string', required: true } }],
    ['db_explain', 'Explain a query plan.', { id: { type: 'string', required: true }, sql: { type: 'string', required: true } }],
    ['db_export', 'Export a result set to a file.', { id: { type: 'string', required: true }, sql: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['db_import', 'Import a file into a table.', { id: { type: 'string', required: true }, table: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['db_migrate', 'Apply pending migrations.', { id: { type: 'string', required: true } }],
    ['db_vacuum', 'Reclaim storage.', { id: { type: 'string', required: true } }],
    ['db_backup', 'Write a consistent backup.', { id: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['db_restore', 'Restore from a backup.', { id: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['db_stats', 'Return table and index statistics.', { id: { type: 'string', required: true } }],
    ['db_slow_queries', 'List recent slow queries.', { id: { type: 'string', required: true }, limit: { type: 'integer' } }],
  ],
  pdf: [
    ['pdf_open', 'Open a PDF document.', { path: { type: 'string', required: true } }],
    ['pdf_close', 'Close a PDF document.', { path: { type: 'string', required: true } }],
    ['pdf_metadata', 'Read document metadata.', { path: { type: 'string', required: true } }],
    ['pdf_page_count', 'Return the number of pages.', { path: { type: 'string', required: true } }],
    ['pdf_extract_text', 'Extract the text layer of a page range.', { path: { type: 'string', required: true }, from: { type: 'integer' }, to: { type: 'integer' } }],
    ['pdf_extract_images', 'Extract embedded images.', { path: { type: 'string', required: true } }],
    ['pdf_layout', 'Return layout blocks with positions.', { path: { type: 'string', required: true } }],
    ['pdf_ocr', 'Run OCR over scanned pages.', { path: { type: 'string', required: true }, language: { type: 'string' } }],
    ['pdf_render', 'Render a page to an image.', { path: { type: 'string', required: true }, page: { type: 'integer', required: true } }],
    ['pdf_annotate', 'Add an annotation.', { path: { type: 'string', required: true }, page: { type: 'integer', required: true }, text: { type: 'string', required: true } }],
    ['pdf_merge', 'Merge several documents.', { paths: { type: 'array', items: { type: 'string' } } }],
    ['pdf_split', 'Split a document by page ranges.', { path: { type: 'string', required: true }, ranges: { type: 'array', items: { type: 'string' } } }],
    ['pdf_rotate', 'Rotate pages.', { path: { type: 'string', required: true }, degrees: { type: 'integer', required: true } }],
    ['pdf_compress', 'Reduce file size.', { path: { type: 'string', required: true } }],
    ['pdf_encrypt', 'Encrypt with a password.', { path: { type: 'string', required: true }, password: { type: 'string', required: true } }],
    ['pdf_decrypt', 'Remove password protection.', { path: { type: 'string', required: true }, password: { type: 'string', required: true } }],
    ['pdf_export', 'Export to another format.', { path: { type: 'string', required: true }, format: { type: 'string', required: true } }],
    ['pdf_form_fields', 'List form fields.', { path: { type: 'string', required: true } }],
    ['pdf_fill_form', 'Fill form fields.', { path: { type: 'string', required: true }, fields: { type: 'object', additionalProperties: true } }],
    ['pdf_sign', 'Apply a digital signature.', { path: { type: 'string', required: true }, key: { type: 'string', required: true } }],
  ],
  image: [
    ['image_open', 'Open an image.', { path: { type: 'string', required: true } }],
    ['image_info', 'Return dimensions and format.', { path: { type: 'string', required: true } }],
    ['image_resize', 'Resize to the given dimensions.', { path: { type: 'string', required: true }, width: { type: 'integer' }, height: { type: 'integer' } }],
    ['image_crop', 'Crop to a rectangle.', { path: { type: 'string', required: true }, x: { type: 'integer', required: true }, y: { type: 'integer', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true } }],
    ['image_rotate', 'Rotate by degrees.', { path: { type: 'string', required: true }, degrees: { type: 'integer', required: true } }],
    ['image_flip', 'Flip horizontally or vertically.', { path: { type: 'string', required: true }, axis: { type: 'string', required: true } }],
    ['image_convert', 'Convert to another format.', { path: { type: 'string', required: true }, format: { type: 'string', required: true } }],
    ['image_compress', 'Re-encode with lower quality.', { path: { type: 'string', required: true }, quality: { type: 'integer' } }],
    ['image_watermark', 'Draw a text watermark.', { path: { type: 'string', required: true }, text: { type: 'string', required: true } }],
    ['image_ocr', 'Extract text from an image.', { path: { type: 'string', required: true }, language: { type: 'string' } }],
    ['image_thumbnail', 'Create a thumbnail.', { path: { type: 'string', required: true }, size: { type: 'integer' } }],
    ['image_palette', 'Extract the dominant palette.', { path: { type: 'string', required: true } }],
    ['image_compare', 'Compare two images.', { left: { type: 'string', required: true }, right: { type: 'string', required: true } }],
    ['image_metadata', 'Read EXIF metadata.', { path: { type: 'string', required: true } }],
    ['image_strip_metadata', 'Remove EXIF metadata.', { path: { type: 'string', required: true } }],
    ['image_composite', 'Composite two images.', { base: { type: 'string', required: true }, overlay: { type: 'string', required: true } }],
    ['image_filter', 'Apply a named filter.', { path: { type: 'string', required: true }, name: { type: 'string', required: true } }],
    ['image_batch', 'Apply an operation to a directory.', { dir: { type: 'string', required: true }, operation: { type: 'string', required: true } }],
  ],
  net: [
    ['net_http_get', 'Perform an HTTP GET request.', { url: { type: 'string', required: true }, headers: { type: 'object', additionalProperties: true } }],
    ['net_http_post', 'Perform an HTTP POST request.', { url: { type: 'string', required: true }, body: { type: 'string' }, headers: { type: 'object', additionalProperties: true } }],
    ['net_http_put', 'Perform an HTTP PUT request.', { url: { type: 'string', required: true }, body: { type: 'string' } }],
    ['net_http_delete', 'Perform an HTTP DELETE request.', { url: { type: 'string', required: true } }],
    ['net_download', 'Download a URL to a file.', { url: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['net_upload', 'Upload a file to a URL.', { url: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['net_dns', 'Resolve a host name.', { host: { type: 'string', required: true } }],
    ['net_ping', 'Ping a host.', { host: { type: 'string', required: true }, count: { type: 'integer' } }],
    ['net_port_scan', 'Check whether ports are open.', { host: { type: 'string', required: true }, ports: { type: 'array', items: { type: 'integer' } } }],
    ['net_tls_info', 'Inspect a TLS certificate.', { host: { type: 'string', required: true } }],
    ['net_whois', 'Query registration data for a domain.', { domain: { type: 'string', required: true } }],
    ['net_headers', 'Return response headers only.', { url: { type: 'string', required: true } }],
    ['net_status', 'Return the status code only.', { url: { type: 'string', required: true } }],
    ['net_redirects', 'Follow the redirect chain.', { url: { type: 'string', required: true } }],
    ['net_robots', 'Fetch and parse robots.txt.', { url: { type: 'string', required: true } }],
    ['net_sitemap', 'Fetch and parse a sitemap.', { url: { type: 'string', required: true } }],
    ['net_speed', 'Measure response timing.', { url: { type: 'string', required: true } }],
    ['net_proxy_check', 'Test an HTTP proxy.', { proxy: { type: 'string', required: true } }],
  ],
  cloud: [
    ['cloud_login', 'Authenticate to the cloud provider.', { profile: { type: 'string', required: true } }],
    ['cloud_logout', 'Clear the current session.', {}],
    ['cloud_list_regions', 'List available regions.', {}],
    ['cloud_list_instances', 'List compute instances.', { region: { type: 'string' } }],
    ['cloud_start_instance', 'Start an instance.', { id: { type: 'string', required: true } }],
    ['cloud_stop_instance', 'Stop an instance.', { id: { type: 'string', required: true } }],
    ['cloud_restart_instance', 'Restart an instance.', { id: { type: 'string', required: true } }],
    ['cloud_create_instance', 'Create an instance.', { spec: { type: 'object', additionalProperties: true } }],
    ['cloud_delete_instance', 'Delete an instance.', { id: { type: 'string', required: true } }],
    ['cloud_list_buckets', 'List storage buckets.', {}],
    ['cloud_create_bucket', 'Create a bucket.', { name: { type: 'string', required: true } }],
    ['cloud_delete_bucket', 'Delete a bucket.', { name: { type: 'string', required: true } }],
    ['cloud_upload_object', 'Upload an object.', { bucket: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['cloud_download_object', 'Download an object.', { bucket: { type: 'string', required: true }, key: { type: 'string', required: true } }],
    ['cloud_list_functions', 'List serverless functions.', {}],
    ['cloud_invoke_function', 'Invoke a function.', { name: { type: 'string', required: true }, payload: { type: 'object', additionalProperties: true } }],
    ['cloud_deploy_function', 'Deploy a function.', { name: { type: 'string', required: true }, path: { type: 'string', required: true } }],
    ['cloud_logs', 'Read recent logs.', { service: { type: 'string', required: true }, limit: { type: 'integer' } }],
    ['cloud_metrics', 'Read metrics for a service.', { service: { type: 'string', required: true } }],
    ['cloud_cost', 'Estimate current cost.', { period: { type: 'string' } }],
  ],
  fs: [
    ['fs_list', 'List a directory.', { path: { type: 'string', required: true } }],
    ['fs_tree', 'Return a directory tree.', { path: { type: 'string', required: true }, depth: { type: 'integer' } }],
    ['fs_stat', 'Return file metadata.', { path: { type: 'string', required: true } }],
    ['fs_read', 'Read a text file.', { path: { type: 'string', required: true } }],
    ['fs_write', 'Write a text file.', { path: { type: 'string', required: true }, content: { type: 'string', required: true } }],
    ['fs_append', 'Append to a text file.', { path: { type: 'string', required: true }, content: { type: 'string', required: true } }],
    ['fs_copy', 'Copy a file or directory.', { from: { type: 'string', required: true }, to: { type: 'string', required: true } }],
    ['fs_move', 'Move a file or directory.', { from: { type: 'string', required: true }, to: { type: 'string', required: true } }],
    ['fs_delete', 'Delete a file or directory.', { path: { type: 'string', required: true } }],
    ['fs_mkdir', 'Create a directory.', { path: { type: 'string', required: true } }],
    ['fs_touch', 'Create an empty file.', { path: { type: 'string', required: true } }],
    ['fs_hash', 'Return a content hash.', { path: { type: 'string', required: true }, algorithm: { type: 'string' } }],
    ['fs_search', 'Search file names.', { root: { type: 'string', required: true }, pattern: { type: 'string', required: true } }],
    ['fs_grep', 'Search file contents.', { root: { type: 'string', required: true }, pattern: { type: 'string', required: true } }],
    ['fs_watch', 'Watch a path for changes.', { path: { type: 'string', required: true } }],
    ['fs_chmod', 'Change file permissions.', { path: { type: 'string', required: true }, mode: { type: 'string', required: true } }],
    ['fs_disk_usage', 'Report disk usage.', { path: { type: 'string', required: true } }],
    ['fs_zip', 'Create an archive.', { path: { type: 'string', required: true }, out: { type: 'string', required: true } }],
    ['fs_unzip', 'Extract an archive.', { path: { type: 'string', required: true }, out: { type: 'string', required: true } }],
    ['fs_temp', 'Create a temporary path.', {}],
  ],
}

/** Flat list of every pool tool: `{ name, description, parameters }`. */
export const POOL = Object.entries(SPEC).flatMap(([domain, tools]) =>
  tools.map(([name, description, parameters]) => ({ domain, name, description, parameters })),
)

/** Domain sizes, for the report. */
export const DOMAINS = Object.fromEntries(Object.entries(SPEC).map(([domain, tools]) => [domain, tools.length]))

/**
 * The semantic operations the Facade arm declares over the pool.
 * Each one is a pipeline whose steps are pool tools; `from` maps one input
 * field into that step's arguments. Chosen where the pool has an obvious
 * pipeline, not to make the numbers look good.
 */
export const FACADE_OPERATIONS = [
  {
    id: 'git',
    description: 'Inspect and change one repository.',
    operations: [
      { name: 'inspect', description: 'Status, recent history and current diff of a repository in one call.', parameters: { repo: { type: 'string', required: true } }, steps: [{ tool: 'git_status' }, { tool: 'git_log' }, { tool: 'git_diff' }] },
      { name: 'commit', description: 'Stage the given paths and commit them with a message.', parameters: { repo: { type: 'string', required: true }, paths: { type: 'array', items: { type: 'string' } }, message: { type: 'string', required: true } }, steps: [{ tool: 'git_add' }, { tool: 'git_commit' }] },
    ],
  },
  {
    id: 'pdf',
    description: 'Read and change a PDF document.',
    operations: [
      { name: 'analyze', description: 'Metadata, page count, text and layout of a PDF in one call.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'pdf_metadata' }, { tool: 'pdf_page_count' }, { tool: 'pdf_extract_text' }, { tool: 'pdf_layout' }] },
      { name: 'convert', description: 'Render the first page and export the document to another format.', parameters: { path: { type: 'string', required: true }, format: { type: 'string', required: true } }, steps: [{ tool: 'pdf_render' }, { tool: 'pdf_export' }] },
    ],
  },
  {
    id: 'image',
    description: 'Read and change an image.',
    operations: [
      { name: 'analyze', description: 'Dimensions, format, EXIF and palette of an image in one call.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'image_info' }, { tool: 'image_metadata' }, { tool: 'image_palette' }] },
      { name: 'transform', description: 'Resize, convert and compress an image in one call.', parameters: { path: { type: 'string', required: true }, width: { type: 'integer' }, format: { type: 'string' } }, steps: [{ tool: 'image_resize' }, { tool: 'image_convert' }, { tool: 'image_compress' }] },
    ],
  },
  {
    id: 'db',
    description: 'Query and maintain one database connection.',
    operations: [
      { name: 'explore', description: 'List tables, then describe one table and its indexes.', parameters: { id: { type: 'string', required: true }, table: { type: 'string', required: true } }, steps: [{ tool: 'db_tables' }, { tool: 'db_schema' }, { tool: 'db_indexes' }] },
      { name: 'backup', description: 'Write a backup of the database.', parameters: { id: { type: 'string', required: true }, path: { type: 'string', required: true } }, steps: [{ tool: 'db_backup' }] },
    ],
  },
  {
    id: 'web',
    description: 'Fetch a URL and report what came back.',
    operations: [
      { name: 'inspect', description: 'Headers, status, redirect chain and timing for one URL.', parameters: { url: { type: 'string', required: true } }, steps: [{ tool: 'net_headers' }, { tool: 'net_status' }, { tool: 'net_redirects' }, { tool: 'net_speed' }] },
    ],
  },
  {
    id: 'browser',
    description: 'Drive one browser page.',
    operations: [
      { name: 'inspect', description: 'Accessibility snapshot, console messages and recent network requests.', parameters: {}, steps: [{ tool: 'browser_snapshot' }, { tool: 'browser_console' }, { tool: 'browser_network' }] },
      { name: 'fill', description: 'Type into an input and press Enter.', parameters: { selector: { type: 'string', required: true }, text: { type: 'string', required: true } }, steps: [{ tool: 'browser_type' }, { tool: 'browser_press' }] },
    ],
  },
  {
    id: 'workspace',
    description: 'Read and change files in one directory.',
    operations: [
      { name: 'survey', description: 'Tree, disk usage and a content search over one directory.', parameters: { path: { type: 'string', required: true }, pattern: { type: 'string', required: true } }, steps: [{ tool: 'fs_tree' }, { tool: 'fs_disk_usage' }, { tool: 'fs_grep' }] },
      { name: 'archive', description: 'Create an archive and report its hash.', parameters: { path: { type: 'string', required: true }, out: { type: 'string', required: true } }, steps: [{ tool: 'fs_zip' }, { tool: 'fs_hash' }] },
    ],
  },
  {
    id: 'cloud',
    description: 'Operate one cloud service.',
    operations: [
      { name: 'inspect', description: 'Recent logs and metrics for a service.', parameters: { service: { type: 'string', required: true } }, steps: [{ tool: 'cloud_logs' }, { tool: 'cloud_metrics' }] },
      { name: 'publish', description: 'Deploy a function and invoke it once.', parameters: { name: { type: 'string', required: true }, path: { type: 'string', required: true } }, steps: [{ tool: 'cloud_deploy_function' }, { tool: 'cloud_invoke_function' }] },
    ],
  },
]
