/**
 * Local test harness for dsh-capability-facade.
 *
 * Runs the REAL DSH tool registry (`@deepseek-ai/dsh-tools` on a real Cordis
 * context) with stub tools standing in for a plugin's implementation surface.
 * Nothing about the registry is mocked: `register`, `schemas`, `restrict`,
 * `execute`, the nested-dispatch path, guards, and disposal are the shipped
 * implementations, so what these tests prove holds for the real harness.
 *
 * Usage: node --import ./test/loader.mjs test/harness.mjs
 */

const DSH = 'file:///C:/Users/14100/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/'
const FACADE = new URL('../lib/index.js', import.meta.url).href

const { Context } = await import(`${DSH}cordis/lib/index.js`)
const { ToolRuntime, defineTool } = await import(`${DSH}dsh-tools/lib/index.js`)
const { createScope } = await import(`${DSH}dsh-scope/lib/index.js`)
const facade = await import(FACADE)

/* ------------------------------------------------------------------ *
 * assertions
 * ------------------------------------------------------------------ */

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` 鈥?${detail}`}`)
  }
}

function equal(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  check(name, a === e, `expected ${e}, got ${a}`)
}

/* ------------------------------------------------------------------ *
 * harness
 * ------------------------------------------------------------------ */

/** A systemPrompt stub: ToolRuntime registers its schema wiring through it. */
const SYSTEM_PROMPT_STUB = {
  tools: () => () => {},
  section: () => () => {},
  getSectionOrder: () => 100,
}

/** Build a real tool registry, then mount the facade and await its fiber. */
async function makeFacade() {
  const root = new Context()
  root.provide('systemPrompt', SYSTEM_PROMPT_STUB)
  const tools = new ToolRuntime(root, {})
  await root.plugin(facade)
  return { root, tools, capabilities: root.get('capabilities') }
}

const SIGNAL = () => new AbortController().signal

/** Register a stub implementation tool; records every dispatch it receives. */
function stubTool(tools, name, options = {}) {
  const calls = []
  tools.register(
    defineTool({
      name,
      description: `${name} stub`,
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render(_args, value) {
          return [{ type: 'text', text: `${name}: ${JSON.stringify(value)}` }]
        },
      },
      async execute(args, exec) {
        calls.push({ args, callId: exec.callId, rootCallId: exec.rootCallId, parent: exec.parent !== undefined, agent: exec.agent?.id })
        if (options.execute) return options.execute(args, exec)
        return { tool: name, echo: args }
      },
    }),
  )
  return calls
}

/* ------------------------------------------------------------------ *
 * 1. registration contract
 * ------------------------------------------------------------------ */

console.log('\n# 1. registration contract')

{
  const { tools, capabilities } = await makeFacade()
  check('service published as ctx.capabilities', capabilities !== undefined && typeof capabilities.register === 'function')
  equal('no capability declared -> no model-facing tool added', tools.schemas().map((s) => s.name), [])

  stubTool(tools, 'pdf_extract')
  stubTool(tools, 'pdf_layout')
  stubTool(tools, 'pdf_ocr')

  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [
      { name: 'analyze', description: 'Extract text and layout from a PDF.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_layout' }] },
      { name: 'scan', description: 'OCR a scanned PDF.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'pdf_ocr' }] },
    ],
  })
  equal('declared operations become model-facing tools', tools.schemas().map((s) => s.name), ['pdf_extract', 'pdf_layout', 'pdf_ocr', 'pdf_analyze', 'pdf_scan'])
  equal('the listing reports the capability', capabilities.list().map((c) => [c.id, c.tools]), [['pdf', ['pdf_analyze', 'pdf_scan']]])
}

/* ------------------------------------------------------------------ *
 * 2. fail-loud registration
 * ------------------------------------------------------------------ */

console.log('\n# 2. fail-loud registration')

{
  const { tools, capabilities } = await makeFacade()
  stubTool(tools, 'pdf_extract')
  stubTool(tools, 'pdf_layout')

  let message = ''
  try {
    capabilities.register({
      id: 'pdf',
      description: 'x',
      operations: [{ name: 'analyze', description: 'x', steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_render' }] }],
    })
  } catch (error) {
    message = error.message
  }
  check('unknown tool is refused at registration', message.includes('pdf_render'), message)
  equal('a refused capability registers nothing', tools.schemas().map((s) => s.name), ['pdf_extract', 'pdf_layout'])
  equal('a refused capability is not listed', capabilities.list(), [])

  let duplicate = ''
  try {
    capabilities.register({ id: 'pdf', description: 'x', operations: [{ name: 'a', description: 'x', steps: [{ tool: 'pdf_extract' }] }] })
    capabilities.register({ id: 'pdf', description: 'y', operations: [{ name: 'b', description: 'y', steps: [{ tool: 'pdf_extract' }] }] })
  } catch (error) {
    duplicate = error.message
  }
  check('duplicate capability id is refused', duplicate.includes('already registered'), duplicate)
}

/* ------------------------------------------------------------------ *
 * 3. schema convergence
 * ------------------------------------------------------------------ */

console.log('\n# 3. schema convergence (7 implementation tools -> 2 semantic operations)')

{
  const { tools, capabilities } = await makeFacade()
  for (const name of ['pdf_read', 'pdf_extract', 'pdf_render', 'pdf_layout', 'pdf_ocr', 'pdf_annotate', 'pdf_export']) stubTool(tools, name)
  const before = tools.schemas().length
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [
      { name: 'analyze', description: 'Extract text, layout and OCR from a PDF.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_layout' }, { tool: 'pdf_ocr' }] },
      { name: 'modify', description: 'Render, annotate and export a PDF.', parameters: { path: { type: 'string', required: true } }, steps: [{ tool: 'pdf_render' }, { tool: 'pdf_annotate' }, { tool: 'pdf_export' }] },
    ],
  })
  const after = tools.schemas().map((s) => s.name)
  check('7 implementation tools stay in the runtime', before === 7, String(before))
  equal('facade adds exactly one tool per semantic operation', after, [
    'pdf_read',
    'pdf_extract',
    'pdf_render',
    'pdf_layout',
    'pdf_ocr',
    'pdf_annotate',
    'pdf_export',
    'pdf_analyze',
    'pdf_modify',
  ])
  const description = tools.schemas().find((s) => s.name === 'pdf_analyze').description
  check(
    'the model sees the declared order',
    description.includes('1. pdf_extract') && description.includes('2. pdf_layout') && description.includes('3. pdf_ocr'),
    description,
  )
}

/* ------------------------------------------------------------------ *
 * 4. pipeline execution through the real pipeline
 * ------------------------------------------------------------------ */

console.log('\n# 4. one model call -> deterministic pipeline')

{
  const { tools, capabilities } = await makeFacade()
  const extractCalls = stubTool(tools, 'pdf_extract', { execute: (args) => ({ text: `extracted ${args.path}` }) })
  const layoutCalls = stubTool(tools, 'pdf_layout', { execute: (args) => ({ blocks: 3, path: args.path }) })
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [
      {
        name: 'analyze',
        description: 'Extract text and layout from a PDF.',
        parameters: { path: { type: 'string', required: true } },
        steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_layout' }],
      },
    ],
  })

  const result = await tools.execute({ callId: 'call-1', name: 'pdf_analyze', arguments: { path: 'a.pdf' }, signal: SIGNAL() })
  check('facade call succeeds', result.isError === false, JSON.stringify(result.error))
  equal('steps ran in declared order', [extractCalls.length, layoutCalls.length], [1, 1])
  equal('each step received the operation input', [extractCalls[0].args, layoutCalls[0].args], [{ path: 'a.pdf' }, { path: 'a.pdf' }])
  check(
    'steps are nested under the facade call, not root calls',
    extractCalls[0].parent === true && extractCalls[0].rootCallId === 'call-1' && layoutCalls[0].rootCallId === 'call-1',
    JSON.stringify([extractCalls[0], layoutCalls[0]]),
  )
  equal('facade value marks success', result.value.ok, true)
  equal('facade value names the capability and operation', [result.value.capability, result.value.operation], ['pdf', 'analyze'])
  equal('per-step values are exposed', result.value.steps.map((s) => s.value), [{ text: 'extracted a.pdf' }, { blocks: 3, path: 'a.pdf' }])
  check('model-facing content is text', result.content[0].type === 'text' && result.content[0].text.includes('pdf_extract'), JSON.stringify(result.content))
}

/* ------------------------------------------------------------------ *
 * 5. per-step argument mapping
 * ------------------------------------------------------------------ */

console.log('\n# 5. per-step argument mapping (from)')

{
  const { tools, capabilities } = await makeFacade()
  const calls = stubTool(tools, 'pdf_render')
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [
      {
        name: 'modify',
        description: 'Render a page.',
        parameters: { path: { type: 'string', required: true }, render: { type: 'json' } },
        steps: [{ tool: 'pdf_render', from: 'render' }],
      },
    ],
  })

  const ok = await tools.execute({ callId: 'c', name: 'pdf_modify', arguments: { path: 'a.pdf', render: { page: 2 } }, signal: SIGNAL() })
  equal('from maps one input field into the step arguments', calls[0].args, { page: 2 })
  equal('mapped step succeeds', ok.value.ok, true)

  const missing = await tools.execute({ callId: 'c2', name: 'pdf_modify', arguments: { path: 'a.pdf' }, signal: SIGNAL() })
  equal('a missing mapped field fails the operation with a clear reason', [missing.value.ok, missing.value.failedStep], [false, 'pdf_render'])
  check('the reason names the missing field', missing.value.error.includes('render'), missing.value.error)
  equal('a missing mapped field does not dispatch the step', calls.length, 1)
}

/* ------------------------------------------------------------------ *
 * 6. authority is not laundered
 * ------------------------------------------------------------------ */

console.log('\n# 6. guards still apply to the underlying tool')

{
  const { tools, capabilities } = await makeFacade()
  const calls = stubTool(tools, 'pdf_extract')
  tools.guard((exec) => (exec.name === 'pdf_extract' ? 'denied by policy: pdf_extract is not allowed here' : undefined))
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [{ name: 'analyze', description: 'Extract.', parameters: { path: { type: 'string' } }, steps: [{ tool: 'pdf_extract' }] }],
  })

  const result = await tools.execute({ callId: 'c', name: 'pdf_analyze', arguments: { path: 'a.pdf' }, signal: SIGNAL() })
  equal('guarded step does not run', calls.length, 0)
  equal('facade reports the denied step as failed', [result.value.ok, result.value.failedStep], [false, 'pdf_extract'])
  check('the guard reason reaches the model verbatim', result.value.error.includes('denied by policy'), result.value.error)
}

/* ------------------------------------------------------------------ *
 * 7. failure semantics
 * ------------------------------------------------------------------ */

console.log('\n# 7. a failing step stops the pipeline and is reported')

{
  const { tools, capabilities } = await makeFacade()
  const first = stubTool(tools, 'pdf_extract', { execute: () => { throw new Error('corrupt file') } })
  const second = stubTool(tools, 'pdf_layout')
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [
      { name: 'analyze', description: 'Extract then lay out.', parameters: { path: { type: 'string' } }, steps: [{ tool: 'pdf_extract' }, { tool: 'pdf_layout' }] },
    ],
  })

  const result = await tools.execute({ callId: 'c', name: 'pdf_analyze', arguments: { path: 'a.pdf' }, signal: SIGNAL() })
  equal('first step ran', first.length, 1)
  equal('later step was not dispatched', second.length, 0)
  equal('facade value marks the failure', [result.value.ok, result.value.failedStep], [false, 'pdf_extract'])
  check('the tool error message reaches the model', result.value.error.includes('corrupt file'), result.value.error)
  check('the facade call itself is not an infrastructure failure', result.isError === false)
}

/* ------------------------------------------------------------------ *
 * 8. lifecycle
 * ------------------------------------------------------------------ */

console.log('\n# 8. lifecycle: dispose removes exactly what the capability added')

{
  const { tools, capabilities } = await makeFacade()
  stubTool(tools, 'pdf_extract')
  const dispose = capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [{ name: 'analyze', description: 'Extract.', steps: [{ tool: 'pdf_extract' }] }],
  })
  equal('operation tool is registered', tools.schemas().map((s) => s.name), ['pdf_extract', 'pdf_analyze'])
  dispose()
  equal('disposer withdraws the operation tool', tools.schemas().map((s) => s.name), ['pdf_extract'])
  equal('disposer clears the listing', capabilities.list(), [])
  dispose()
  check('disposer is idempotent', true)
  capabilities.register({ id: 'pdf', description: 'again', operations: [{ name: 'analyze', description: 'x', steps: [{ tool: 'pdf_extract' }] }] })
  equal('the id can be registered again after disposal', capabilities.list().map((c) => c.id), ['pdf'])
}

/* ------------------------------------------------------------------ *
 * 9. the restriction constraint, pinned as a test
 * ------------------------------------------------------------------ */

console.log('\n# 9. pinned constraint: restrict() cuts nested dispatch too')

{
  const { root, tools, capabilities } = await makeFacade()
  stubTool(tools, 'pdf_extract')
  capabilities.register({
    id: 'pdf',
    description: 'Read and change PDF documents.',
    operations: [{ name: 'analyze', description: 'Extract.', steps: [{ tool: 'pdf_extract' }] }],
  })

  const agent = { id: 'agent-under-test' }
  const scope = createScope(root, agent)
  scope.ctx.get('tools').restrict({ deny: ['pdf_extract'] })
  equal('the restricted tool leaves the model view', tools.schemas(agent).map((s) => s.name), ['pdf_analyze'])

  const result = await tools.execute({ callId: 'c', name: 'pdf_analyze', arguments: { path: 'a.pdf' }, agent, signal: SIGNAL() })
  equal('the facade cannot reach the restricted tool either', [result.value.ok, result.value.failedStep], [false, 'pdf_extract'])
  check('the failure is the registry UNKNOWN_TOOL, not a silent success', String(result.value.error).includes('unknown tool'), result.value.error)
}

/* ------------------------------------------------------------------ *
 * 10. narrowing is authoring-time, not facade-time
 * ------------------------------------------------------------------ */

console.log('\n# 10. narrowing is authoring-time: a hidden tool is unreachable')

{
  // This test records WHY the facade does not hide anything. It states, for the
  // scoped case a capability is actually declared in, that `restrict()` cannot
  // name a scoped (own-layer) registration at all, and that a restricted global
  // is unreachable for nested dispatch. The honest design follows: a plugin that
  // wants a narrow surface must not register its implementation tools as
  // model-facing in the first place.
  const { root, tools } = await makeFacade()
  const agent = { id: 'agent-scoped' }
  const scope = createScope(root, agent)
  const scopedTools = scope.ctx.get('tools')

  scopedTools.register(
    defineTool({
      name: 'scoped_primitive',
      description: 'scoped primitive',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute() {
        return { ran: true }
      },
    }),
  )
  equal('a scoped registration is visible in its scope', scopedTools.schemas(agent).map((s) => s.name), ['scoped_primitive'])

  let refused = ''
  try {
    scopedTools.restrict({ deny: ['scoped_primitive'] })
  } catch (error) {
    refused = error.message
  }
  check('restrict() refuses a scoped (own-layer) tool name', refused.includes('unknown global tool'), refused)
  equal('the scoped tool therefore stays visible', scopedTools.schemas(agent).map((s) => s.name), ['scoped_primitive'])

  // And a global tool that IS restricted leaves the nested-dispatch path too.
  tools.register(
    defineTool({
      name: 'global_primitive',
      description: 'global primitive',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute() {
        return { ran: true }
      },
    }),
  )
  scopedTools.restrict({ deny: ['global_primitive'] })
  const hidden = await scopedTools.execute({ callId: 'c', name: 'global_primitive', arguments: {}, agent, signal: SIGNAL() })
  check('a restricted global is not dispatchable even inside the scope', hidden.isError === true && String(hidden.error.message).includes('unknown tool'), JSON.stringify(hidden.error))
}

/* ------------------------------------------------------------------ *
 * 11. agent plane: a capability declared into one agent scope
 * ------------------------------------------------------------------ */

console.log('\n# 11. scoped registration: a capability for one agent')

{
  // This is how a preset would use the facade: the capability and its steps
  // live in the agent's own scope, so nothing leaks to other agents and the
  // operation tool is visible only where it was declared.
  const { root, capabilities } = await makeFacade()
  const agent = { id: 'agent-preset' }
  const other = { id: 'agent-other' }
  const scope = createScope(root, agent)
  const scopedTools = scope.ctx.get('tools')
  const calls = []

  scopedTools.register(
    defineTool({
      name: 'preset_extract',
      description: 'agent-scoped primitive',
      parameters: { path: { type: 'string' } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
      async execute(args, exec) {
        calls.push({ nested: exec.parent !== undefined, agent: exec.agent?.id })
        return { path: args.path }
      },
    }),
  )

  const dispose = capabilities.register(
    {
      id: 'preset',
      description: 'A capability declared for one agent.',
      operations: [{ name: 'read', description: 'Read through the scoped primitive.', parameters: { path: { type: 'string' } }, steps: [{ tool: 'preset_extract' }] }],
    },
    { scope: scope.ctx, agent },
  )

  equal('the operation is visible to its agent', scopedTools.schemas(agent).map((s) => s.name).sort(), ['preset_extract', 'preset_read'])
  equal('another agent sees nothing of it', scopedTools.schemas(other).map((s) => s.name), [])

  const result = await scopedTools.execute({ callId: 'c', name: 'preset_read', arguments: { path: 'x.pdf' }, agent, signal: SIGNAL() })
  equal('the scoped capability runs', result.value.ok, true)
  equal('its step dispatched nested, with the calling agent', calls, [{ nested: true, agent: 'agent-preset' }])

  dispose()
  equal('dispose withdraws only the operation', scopedTools.schemas(agent).map((s) => s.name), ['preset_extract'])
}

/* ------------------------------------------------------------------ *
 * summary
 * ------------------------------------------------------------------ */

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} 鈥?${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
