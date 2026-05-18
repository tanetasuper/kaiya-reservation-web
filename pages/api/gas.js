export default async function handler(req, res) {
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return res.json({ error: 'GAS_URL not set in environment' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)

  try {
    const params = new URLSearchParams()

    for (const [k, v] of Object.entries(req.query || {})) {
      params.set(k, v)
    }

    if (req.method !== 'GET' && req.body) {
      const body = req.body
      if (body.action) params.set('action', body.action)
      params.set('body', JSON.stringify(body))
    }

    const response = await fetch(`${gasUrl}?${params}`, { signal: controller.signal })
    clearTimeout(timer)
    const text = await response.text()

    try {
      res.json(JSON.parse(text))
    } catch {
      res.json({
        error: 'GAS returned non-JSON',
        preview: text.slice(0, 300),
      })
    }
  } catch (err) {
    clearTimeout(timer)
    res.json({ error: err.name === 'AbortError' ? 'GASタイムアウト (>25s)' : err.message })
  }
}
