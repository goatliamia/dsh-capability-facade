/**
 * Experiment: rewrite two of our own plugins' model-facing surfaces as
 * capabilities, without touching the plugins themselves.
 *
 * This file registers NO tool of its own. It reads the `capabilities` service
 * and declares semantic operations over tools that the installed plugins
 * already registered. The point is to show what a plugin's surface *could*
 * look like if its author declared it this way, and to measure the difference.
 *
 * Only operations that genuinely compose are declared here. A facade that
 * wraps one tool per operation adds a name without adding meaning — the honest
 * test is whether two or more primitives answer one question the model asks.
 *
 * dsh-trajectory-tools: 4 tools → 1 operation
 *   trajectory_locate = trajectory_find → trajectory_window
 *   ("where was this said?" then "show me it verbatim" — one call)
 *
 * dsh-plugin-maker: 6 tools → 1 operation
 *   maker_check = plugin_maker_check → plugin_maker_vet
 *   (both take one targetDir and answer "is this plugin compliant?"; the second
 *    turns every violation into a concrete fix)
 *
 * The primitives stay registered: this is a facade, not a replacement. Whether
 * to stop registering them is the plugin author's decision — see
 * docs/constraint-restrict-vs-nested-dispatch.md for why a facade cannot hide
 * them at runtime.
 */

export const name = 'dsh-capability-demo'
export const inject = ['tools', 'capabilities']

/** Declare a capability only when every step tool is actually registered. */
function declare(capabilities, tools, capability) {
  const missing = capability.operations
    .flatMap((operation) => operation.steps)
    .map((step) => step.tool)
    .filter((toolName) => tools.get(toolName) === undefined)
  if (missing.length > 0) {
    // Not an error: a deployment may install only one of the two plugins.
    return { id: capability.id, declared: false, missing: [...new Set(missing)] }
  }
  capabilities.register(capability)
  return { id: capability.id, declared: true, missing: [] }
}

export function apply(ctx) {
  const tools = ctx.get('tools')
  const capabilities = ctx.get('capabilities')
  if (tools === undefined || capabilities === undefined) return

  const results = [
    declare(capabilities, tools, {
      id: 'trajectory',
      description: 'Read the session event log: find where something was said or done, then read it verbatim.',
      operations: [
        {
          name: 'locate',
          description: 'Find a literal substring in one session, then return the surrounding verbatim window — one call instead of two.',
          parameters: {
            query: { type: 'string', required: true, description: 'Literal substring (case-insensitive, whitespace-flexible)' },
            session: { type: 'string', required: true, description: 'Session id, from trajectory_sessions' },
          },
          steps: [{ tool: 'trajectory_find' }, { tool: 'trajectory_window' }],
        },
      ],
    }),
    declare(capabilities, tools, {
      id: 'maker',
      description: 'Plugin workshop: is this plugin compliant, and what exactly needs fixing?',
      operations: [
        {
          name: 'check',
          description: 'Check one plugin directory: contract + release checklist + upgrade baseline, plus a concrete fix for every violation.',
          parameters: { targetDir: { type: 'string', required: true, description: 'Absolute plugin directory' } },
          steps: [{ tool: 'plugin_maker_check' }, { tool: 'plugin_maker_vet' }],
        },
      ],
    }),
  ]

  for (const result of results) {
    ctx.logger?.info?.(
      result.declared
        ? `capability demo: declared ${result.id}`
        : `capability demo: skipped ${result.id} (missing ${result.missing.join(', ')})`,
    )
  }
}

export default { name, inject, apply }
