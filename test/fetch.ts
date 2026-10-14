import { vi } from 'vitest'

export type Reply = { status: number; body?: unknown; raw?: string } | Error
export type Call = { url: string; init: RequestInit }

/** Stubs global fetch. Routes match by URL substring (longest wins); an array replies in order, repeating its last entry. */
export function mockFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = []
  const queues = new Map(
    Object.entries(routes).map(([key, reply]) => [key, Array.isArray(reply) ? [...reply] : [reply]]),
  )
  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, init })
    const key = [...queues.keys()].filter((k) => url.includes(k)).sort((a, b) => b.length - a.length)[0]
    const queue = key === undefined ? undefined : queues.get(key)
    if (!queue) throw new Error(`unmocked fetch ${url}`)
    const reply = queue.length > 1 ? queue.shift() : queue[0]
    if (reply instanceof Error) throw reply
    if (!reply) throw new Error(`empty route ${key}`)
    const body = reply.raw ?? (reply.body === undefined ? null : JSON.stringify(reply.body))
    return new Response(body, { status: reply.status })
  })
  return { calls }
}

export const headersOf = (call: Call | undefined) => (call?.init.headers ?? {}) as Record<string, string>
export const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body))
