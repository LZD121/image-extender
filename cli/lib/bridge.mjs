/**
 * The CLI's side of the bridge protocol: one JSON job spec in, one JSON result
 * out, over a child process.
 *
 * A subprocess (rather than importing the bridge) keeps Chromium's lifecycle
 * contained: when the call returns, the browser is gone and nothing of it is
 * left in the CLI's process — which matters when a studio command runs five
 * passes in a row.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from './args.mjs'

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'native', 'bridge.mjs')

function run(spec, what) {
  const res = spawnSync(process.execPath, [BRIDGE], {
    input: JSON.stringify(spec),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  const stdout = (res.stdout || '').trim()
  if (!stdout) {
    throw new CliError('bridge_failed', `bridge produced no output (${what}): ${(res.stderr || '').trim().slice(0, 800)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new CliError('bridge_protocol', `bridge output was not JSON: ${stdout.slice(0, 800)}`)
  }
  return parsed
}

/** One op. Throws on failure so a command never continues on a broken image. */
export function bridge(job) {
  const parsed = run(job, job.op)
  if (!parsed.ok) throw new CliError('bridge_failed', `${job.op}: ${parsed.error}`, parsed)
  return parsed
}

/** Many ops in one browser; results line up with the jobs you passed. */
export function bridgeBatch(jobs) {
  if (jobs.length === 0) return []
  const parsed = run({ jobs }, `${jobs.length} jobs`)
  if (!parsed.ok) throw new CliError('bridge_failed', parsed.error, parsed)
  return parsed.results
}
