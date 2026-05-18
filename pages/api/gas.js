export const config = { runtime: 'edge' }

const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })

export default async function handler(req) {
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return json({ error: 'GAS_URL not set in environment' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 28000)

  try {
    const params = new URLSearchParams()
    const { searchParams } = new URL(req.url)

    for (const [k, v] of searchParams.entries()) {
      params.set(k, v)
    }

    if (req.method !== 'GET') {
      let body = null
      try { body = await req.json() } catch {}
      if (body) {
        if (body.action) params.set('action', body.action)
        params.set('body', JSON.stringify(body))
      }
    }

    const response = await fetch(`${gasUrl}?${params}`, { signal: controller.signal })
    clearTimeout(timer)
    const text = await response.text()

    try {
      return json(JSON.parse(text))
    } catch {
      return json({ error: 'GAS returned non-JSON', preview: text.slice(0, 300) })
    }
  } catch (err) {
    clearTimeout(timer)
    return json({ error: err.name === 'AbortError' ? 'GASタイムアウト (>28s)' : err.message })
  }
}
