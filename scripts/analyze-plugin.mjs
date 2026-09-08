#!/usr/bin/env node
/**
 * CLI for the read-only plugin tool-surface analyzer.
 *
 *   node scripts/analyze-plugin.mjs <plugin-dir>              # markdown report
 *   node scripts/analyze-plugin.mjs <plugin-dir> --json       # machine-readable
 *   node scripts/analyze-plugin.mjs <plugin-dir> --propose    # + starter declarations
 *
 * Read-only: it opens files and prints. It never writes into the target and
 * never decides that a tool should be removed.
 */
import { analyzePlugin, renderProposal, renderReport } from '../lib/analyze.mjs'

const args = process.argv.slice(2)
const flags = new Set(args.filter((argument) => argument.startsWith('--')))
const target = args.find((argument) => !argument.startsWith('--'))

if (target === undefined) {
  console.error('usage: node scripts/analyze-plugin.mjs <plugin-dir> [--json] [--propose]')
  process.exit(2)
}

const report = await analyzePlugin(target)

if (flags.has('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(renderReport(report))
  if (flags.has('--propose') && report.candidates.length > 0) {
    for (const candidate of report.candidates) {
      console.log('')
      console.log('---')
      console.log('')
      console.log(`## Starter declaration for \`${candidate.group}\``)
      console.log('')
      console.log('```js')
      console.log(renderProposal(candidate))
      console.log('```')
    }
  }
}
