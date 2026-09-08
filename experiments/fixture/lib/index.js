/**
 * Test-only fixture for the capability facade experiment.
 *
 * Stands in for "a plugin that owns implementation tools". It registers two
 * implementation-detail tools (`pdf_extract`, `pdf_layout`) and — when the
 * facade arm is enabled — declares ONE semantic capability over them, so the
 * model sees `pdf_analyze` instead of having to pick and order the primitives.
 *
 * Every dispatch is appended to a JSONL audit file, so the experiment can tell
 * apart "the model called the facade" from "the model called the primitives",
 * and can see that the facade's nested dispatches really happened.
 *
 * Arms (env `FACADE_ARM`):
 *   capability — declare the pdf capability (default)
 *   raw        — register only the primitives, no capability
 *   hidden     — declare the capability, then try to hide the primitives from
 *                the model via ctx.tools.restrict() (negative control: the
 *                restriction must live in an agent scope, which a host-plane
 *                registrant cannot reach — recorded, not fatal)
 *
 * The tools are deterministic on purpose: the experiment asks whether the model
 * reaches for the semantic operation and whether the declared pipeline runs —
 * not whether a real PDF parser works.
 */
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

const ARM = process.env.FACADE_ARM === 'raw' ? 'raw' : process.env.FACADE_ARM === 'hidden' ? 'hidden' : 'capability'
const AUDIT = process.env.FACADE_AUDIT ?? fileURLToPath(new URL('../../audit/calls.jsonl', import.meta.url))

/** Append one audit record; never let audit failure affect the tool result. */
function record(entry) {
  try {
    appendFileSync(AUDIT, `${JSON.stringify({ arm: ARM, ...entry })}\n`, 'utf8')
  } catch {
    /* audit is best-effort */
  }
}

const OUTPUT = {
  schema: { type: 'object', additionalProperties: true },
  render(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }]
  },
}

export const name = 'dsh-facade-fixture'
export const inject = ['tools', 'capabilities']

export function apply(ctx) {
  record({ event: 'mount', arm: ARM })

  ctx.tools.register(
    defineTool({
      name: 'pdf_extract',
      description: 'Implementation detail: extract raw text from a PDF path.',
      parameters: { path: { type: 'string', required: true } },
      output: OUTPUT,
      async execute(args, exec) {
        record({ event: 'tool', tool: 'pdf_extract', path: args.path, nested: exec.parent !== undefined, rootCallId: exec.rootCallId })
        return { text: `text of ${args.path}`, pages: 2 }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'pdf_layout',
      description: 'Implementation detail: compute the layout blocks of a PDF path.',
      parameters: { path: { type: 'string', required: true } },
      output: OUTPUT,
      async execute(args, exec) {
        record({ event: 'tool', tool: 'pdf_layout', path: args.path, nested: exec.parent !== undefined, rootCallId: exec.rootCallId })
        return { blocks: 7, path: args.path }
      },
    }),
  )

  if (ARM === 'raw') {
    ctx.logger?.info?.('fixture: raw arm — primitives registered, no capability declared')
    return
  }

  const capabilities = ctx.get('capabilities')
  if (capabilities === undefined) {
    throw new Error('fixture: capability facade service is not mounted; the facade row must come first')
  }

  capabilities.register({
    id: 'pdf',
    description: 'Read a PDF document: extract its text and its layout in one deterministic step sequence.',
    operations: [
      {
        name: 'analyze',
        description: 'Extract text and layout from a PDF in one call.',
        parameters: { path: { type: 'string', required: true } },
        steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_layout' }],
      },
    ],
  })

  record({ event: 'capability', id: 'pdf', operations: ['pdf_analyze'], tools: ['pdf_extract', 'pdf_layout'] })
  ctx.logger?.info?.('fixture: pdf capability declared over pdf_extract + pdf_layout')

  if (ARM === 'hidden') {
    // Negative control: can a host-plane registrant hide the primitives from
    // the model at all? `restrict()` demands an agent scope, which the facade
    // does not own — record the exact outcome instead of assuming.
    try {
      const dispose = ctx.tools.restrict({ deny: ['pdf_extract', 'pdf_layout'] })
      record({ event: 'restrict', outcome: 'accepted', note: 'restriction installed from a host-plane context' })
      ctx.effect(() => dispose)
    } catch (error) {
      record({ event: 'restrict', outcome: 'refused', message: String((error && error.message) || error) })
    }
  }
}

export default { name, inject, apply }
