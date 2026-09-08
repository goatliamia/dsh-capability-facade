// Fixture for lib/analyze.mjs. Shapes intentionally mirror real community plugins:
// a prefix group of primitives, a semantic-looking operation, a bare (ungrouped)
// tool, a dynamically named tool the analyzer must not guess, and an existing
// capability declaration it must recognize.
import { defineTool } from '@deepseek-ai/dsh-tools'

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'pdf_extract',
    description: 'Extract raw text from a PDF.',
    parameters: { path: { type: 'string', required: true } },
    output: OUTPUT,
    async execute() { return {} },
  }))

  ctx.tools.register(defineTool({
    name: 'pdf_layout',
    description: 'Compute layout blocks of a PDF.',
    parameters: { path: { type: 'string', required: true } },
    output: OUTPUT,
    async execute() { return {} },
  }))

  ctx.tools.register(defineTool({
    name: 'pdf.ocr',
    description: 'OCR a scanned PDF.',
    parameters: { path: { type: 'string', required: true }, language: { type: 'string' } },
    output: OUTPUT,
    async execute() { return {} },
  }))

  ctx.tools.register(defineTool({
    name: 'pdf_analyze',
    description: 'Analyze a PDF and return its text and layout in one call.',
    parameters: { path: { type: 'string', required: true } },
    output: OUTPUT,
    async execute() { return {} },
  }))

  ctx.tools.register(defineTool({
    name: 'standalone_thing',
    description: 'A tool with no prefix group.',
    parameters: {},
    output: OUTPUT,
    async execute() { return {} },
  }))

  // Dynamic name: the analyzer must not invent one.
  for (const kind of ['a', 'b']) {
    ctx.tools.register(defineTool({
      name: `dynamic_${kind}`,
      description: 'Dynamically named tool.',
      parameters: {},
      output: OUTPUT,
      async execute() { return {} },
    }))
  }

  const capabilities = ctx.get('capabilities')
  capabilities?.register({
    id: 'doc',
    description: 'Already-declared capability.',
    operations: [
      { name: 'read', description: 'Read a document.', steps: [{ tool: 'pdf_extract' }] },
    ],
  })
}

const OUTPUT = { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'ok' }] }
