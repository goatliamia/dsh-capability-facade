/**
 * Test-only module resolution shim.
 *
 * The plugin source imports the harness-owned package name
 * `@deepseek-ai/dsh-tools`, which a Profile resolves through its own
 * node_modules. This workspace has no node_modules, so the local harness
 * resolves that one specifier to the installed DSH package explicitly.
 * Nothing here ships with the plugin.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const DSH = pathToFileURL('C:/Users/14100/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/').href

register(
  `data:text/javascript,${encodeURIComponent(`
    const DSH = ${JSON.stringify(DSH)}
    export function resolve(specifier, context, nextResolve) {
      if (specifier === '@deepseek-ai/dsh-tools') return { url: DSH + 'dsh-tools/lib/index.js', shortCircuit: true }
      if (specifier === '@deepseek-ai/cordis') return { url: DSH + 'cordis/lib/index.js', shortCircuit: true }
      if (specifier === '@deepseek-ai/dsh-scope') return { url: DSH + 'dsh-scope/lib/index.js', shortCircuit: true }
      return nextResolve(specifier, context)
    }
  `)}`,
  pathToFileURL(import.meta.filename),
)
