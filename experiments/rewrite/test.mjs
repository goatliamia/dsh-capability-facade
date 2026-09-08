/**
 * Experiment: what the capability surface looks like for two of our own
 * plugins, measured on the real tool registry.
 *
 * Usage: node --import ../../test/loader.mjs test.mjs
 *
 * It mounts the facade + the demo declarations against stub tools that carry
 * the REAL names and parameter shapes of `dsh-plugin-maker` and
 * `dsh-trajectory-tools`, then asserts:
 *   - the declared operations exist and the primitives are untouched;
 *   - a demo operation runs its pipeline as nested dispatches;
 *   - a demo whose step tools are absent declares nothing (fail-soft).
 */

const DSH = 'file:///C:/Users/14100/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/'

const { Context } = await import(`${DSH}cordis/lib/index.js`)
const { ToolRuntime, defineTool } = await import(`${DSH}dsh-tools/lib/index.js`)
const facade = await import('../../lib/index.js')
const demo = await import('./demo-capability/index.mjs')

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`) } else { failed += 1; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${detail}`}`) }
}
const equal = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

const SYSTEM_PROMPT_STUB = { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 100 }
const SIGNAL = () => new AbortController().signal

/** A stub carrying a real tool's name and parameter names. */
function stub(tools, name, parameters) {
  const calls = []
  tools.register(defineTool({
    name,
    description: `${name} stub`,
    parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(args, exec) {
      calls.push({ args, nested: exec.parent !== undefined, rootCallId: exec.rootCallId })
      return { tool: name, got: args }
    },
  }))
  return calls
}

async function mount() {
  const root = new Context()
  root.provide('systemPrompt', SYSTEM_PROMPT_STUB)
  const tools = new ToolRuntime(root, {})
  await root.plugin(facade)
  return { root, tools }
}

console.log('\n# maker: 6 tools -> 1 operation')

{
  const { root, tools } = await mount()
  const names = [
    ['plugin_maker_checklist', { taskType: { type: 'string' } }],
    ['plugin_maker_impact', { keyword: { type: 'string' } }],
    ['plugin_maker_scaffold', { name: { type: 'string' }, description: { type: 'string' }, targetDir: { type: 'string' } }],
    ['plugin_maker_check', { targetDir: { type: 'string' } }],
    ['plugin_maker_vet', { targetDir: { type: 'string' } }],
    ['plugin_maker_adopt', { targetDir: { type: 'string' } }],
  ]
  const calls = Object.fromEntries(names.map(([name, parameters]) => [name, stub(tools, name, parameters)]))

  const before = tools.schemas().length
  await root.plugin(demo)
  const after = tools.schemas().map((schema) => schema.name)

  check('all six primitives remain registered', before === 6, String(before))
  check('exactly one semantic operation is added', after.includes('maker_check'), JSON.stringify(after))
  equal('the operation count is 6 + 1', after.length, 7)
  equal('the capability is listed', root.get('capabilities').list().map((entry) => entry.id).sort(), ['maker'])

  const result = await tools.execute({ callId: 'c1', name: 'maker_check', arguments: { targetDir: 'D:\\x' }, signal: SIGNAL() })
  equal('the operation succeeded', result.value.ok, true)
  equal('both steps ran in order', [calls.plugin_maker_check.length, calls.plugin_maker_vet.length], [1, 1])
  check('both steps are nested under one root call', calls.plugin_maker_check[0].nested && calls.plugin_maker_check[0].rootCallId === 'c1' && calls.plugin_maker_vet[0].rootCallId === 'c1')
  equal('both steps received the operation input', [calls.plugin_maker_check[0].args, calls.plugin_maker_vet[0].args], [{ targetDir: 'D:\\x' }, { targetDir: 'D:\\x' }])
}

console.log('\n# trajectory: 4 tools -> 1 operation')

{
  const { root, tools } = await mount()
  const find = stub(tools, 'trajectory_find', { session: { type: 'string' }, query: { type: 'string' } })
  stub(tools, 'trajectory_sessions', { limit: { type: 'integer' } })
  const window = stub(tools, 'trajectory_window', { session: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } })
  stub(tools, 'trajectory_trace', { session: { type: 'string' }, seq: { type: 'integer' } })

  await root.plugin(demo)
  const names = tools.schemas().map((schema) => schema.name)
  check('the locate operation is added', names.includes('trajectory_locate'), JSON.stringify(names))
  equal('the trajectory primitives are untouched', names.filter((n) => n.startsWith('trajectory_')).sort(), ['trajectory_find', 'trajectory_locate', 'trajectory_sessions', 'trajectory_trace', 'trajectory_window'])

  const result = await tools.execute({ callId: 'c2', name: 'trajectory_locate', arguments: { session: 's1', query: 'boom' }, signal: SIGNAL() })
  equal('the pipeline ran', [find.length, window.length], [1, 1])
  equal('the pipeline value names both steps', result.value.steps.map((step) => step.tool), ['trajectory_find', 'trajectory_window'])
}

console.log('\n# fail-soft: a capability whose steps are absent declares nothing')

{
  const { root, tools } = await mount()
  stub(tools, 'trajectory_find', { session: { type: 'string' }, query: { type: 'string' } })
  // No trajectory_window, no maker tools at all.
  await root.plugin(demo)
  const names = tools.schemas().map((schema) => schema.name)
  equal('no operation was declared', names, ['trajectory_find'])
  equal('nothing is listed', root.get('capabilities').list(), [])
}

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
