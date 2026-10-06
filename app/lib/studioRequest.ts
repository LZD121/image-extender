// app/lib/studioRequest.ts
/**
 * One POST from the studio page: send JSON, turn a failure into an Error that
 * carries the HTTP status, and route a 401 to the caller's key-modal policy.
 * Call sites keep their own success handling and their own fallback copy.
 */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function studioRequest<T>(
  url: string,
  body: unknown,
  opts: { on401?: () => void; fallbackMessage?: string } = {}
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    let message = ''
    try {
      const parsed: unknown = JSON.parse(raw)
      const candidate = (parsed as { error?: unknown } | null)?.error
      if (typeof candidate === 'string') message = candidate
    } catch {
      message = raw.slice(0, 500).trim()
    }
    if (response.status === 401) opts.on401?.()
    throw new ApiError(message.trim() || opts.fallbackMessage || 'Request failed', response.status)
  }

  return (await response.json()) as T
}
