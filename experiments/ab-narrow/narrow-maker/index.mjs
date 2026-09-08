/**
 * Experiment: the authoring-time narrowing the facade is designed for.
 *
 * This plugin exposes exactly ONE model-facing tool (`maker_check`) and no
 * primitives. It reuses the maker's own pure functions (`checkPlugin`,
 * `vetPlugin`) instead of registering the maker's six tools, so the model's
 * surface is 1 tool, not 6 — the opposite arrangement from
 * `experiments/rewrite/demo-capability/`, where the primitives stay registered.
 *
 * It does not mount the maker bundle: `dsh-plugin-maker` is an optional peer,
 * resolved at load time. If it is absent, this plugin registers nothing.
 *
 * The two experiments together bracket the design space:
 *
 *   rewrite/demo-capability : facade over installed tools → 6 + 1 tools, no hiding
 *   ab-narrow/narrow-maker  : semantic tool over the same logic → 1 tool, no primitives
 *
 * The second is the only arrangement that actually shrinks the surface, and it
 * is an authoring decision, not a runtime one.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-narrow-maker'
export const inject = ['tools']

/**
 * The maker is an optional peer: the plugin registers its one tool only when the
 * maker's pure functions resolve. `apply` is synchronous (Cordis contract), so
 * the import is kicked off at module scope and awaited inside `execute`.
 */
const makerPromise = import('dsh-plugin-maker/lib/check-core.mjs').catch(() => undefined)

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'maker_check',
      description:
        'Check one DSH plugin directory: contract + release checklist + upgrade baseline + secret scan, ' +
        'plus a concrete fix for every violation. Read-only.',
      parameters: { targetDir: { type: 'string', required: true, description: 'Absolute plugin directory' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const dir = String(args.targetDir ?? '').trim()
        if (dir === '') return 'targetDir 必填：插件目录绝对路径'
        const maker = await makerPromise
        if (maker === undefined) return 'dsh-plugin-maker 不可解析：无法执行 maker_check（请先安装 maker）'
        const [check, vet] = await Promise.all([maker.checkPlugin(dir), maker.vetPlugin(dir)])
        return check + '\n\n' + vet
      },
    }),
  )

  ctx.logger?.info?.('narrow-maker: registered maker_check (1 model-facing tool, no primitives)')
}

export default { name, inject, apply }
