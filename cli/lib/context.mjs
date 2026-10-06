/**
 * The context every command receives. Commands stay thin: they declare flags,
 * call `ctx.api` / `ctx.bridge` / `ctx.modules`, and return a plain payload the
 * entry point envelopes.
 *
 * Three seams, each one place:
 *   ctx.api      — HTTP to the dev server (generation, briefs, review, pixel)
 *   ctx.bridge   — the app's own pixel code in headless Chromium
 *   ctx.modules  — esbuild-bundled app modules for Node (library, pixelGrid)
 */
import { pathToFileURL } from 'node:url'
import { CliError } from './args.mjs'
import { nodeBundle } from '../native/bundle.mjs'
import { bridge, bridgeBatch } from './bridge.mjs'
import { apiCall, apiGet, ensureServer, routeError } from './server.mjs'

export function createContext({ globals, cmd, note }) {
  const ctx = {
    args: cmd.positionals,
    flags: cmd.values,
    spec: cmd.spec,
    ieConfig: cmd.ieConfig,
    json: !!globals.json,
    profile: globals.profile,
    model: globals.model,
    config: globals.config,
    baseUrl: globals.baseUrl,
    port: globals.port,
    note,

    /**
     * The fields every model-touching request body carries when the caller
     * named a profile/model. Absent keys mean "server decides" — the server
     * falls back to the config file's defaultProfile.
     */
    llmFields() {
      const fields = {}
      if (ctx.profile) fields.profile = ctx.profile
      if (ctx.model) fields.model = ctx.model
      return fields
    },

    async server() {
      ctx._server = ctx._server || (await ensureServer({ baseUrl: globals.baseUrl, port: globals.port, note }))
      return ctx._server
    },

    /**
     * POST a route. A non-2xx answer is an error, with the route's own message.
     * `opts.headers` exists for the routes that authenticate per request
     * (`/api/pixel` takes `x-pixellab-key`).
     */
    async api(route, body, opts) {
      const { url } = await ctx.server()
      const res = await apiCall(url, route, body, opts)
      if (!res.ok) throw routeError(route, res)
      return res.body
    },
    /** A GET route with its HTTP facts intact (status/ok/body). */
    async apiGet(route) {
      const { url } = await ctx.server()
      return apiGet(url, route)
    },

    bridge,
    bridgeBatch,

    /** App modules as Node ESM, bundled on demand and cached by mtime. */
    async modules(name, imports) {
      const file = nodeBundle(name, imports)
      return import(pathToFileURL(file).href)
    },

    fail(code, message, detail) {
      throw new CliError(code, message, detail)
    },
  }
  return ctx
}
