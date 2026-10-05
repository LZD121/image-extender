/**
 * Pull the provider-reported spend out of a chat-completions response body.
 * Only OpenRouter's `usage.cost` is understood; anything else yields null so
 * the library records "unknown" rather than a fabricated number.
 *
 * NOTE: unverified against the real provider (no key on this machine) — purely
 * defensive. If OpenRouter does not send it, `cost` stays null, which is fine.
 *
 * Lives here (not in route.ts) because Next.js route files may only export
 * request handlers and route config.
 */
export function extractCost(data: unknown): { usd: number; source: string } | null {
  const cost = (data as { usage?: { cost?: unknown } } | null)?.usage?.cost
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null
  return { usd: cost, source: 'openrouter' }
}
