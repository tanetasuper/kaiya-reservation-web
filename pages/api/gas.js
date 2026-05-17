export default async function handler(req, res) {
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return res.status(500).json({ error: 'GAS_URL not set in environment' })

  try {
    // Always send as GET to GAS to avoid POST redirect issues.
    // POST body is encoded as a `body` query param.
    const params = new URLSearchParams()

    for (const [k, v] of Object.entries(req.query || {})) {
      params.set(k, v)
    }

    if (req.method !== 'GET' && req.body) {
      const body = req.body
      // Also expose action at top level so GAS doGet can route
      if (body.action) params.set('action', body.action)
      params.set('body', JSON.stringify(body))
    }

    const response = await fetch(`${gasUrl}?${params}`)
    const text = await response.text()

    try {
      res.json(JSON.parse(text))
    } catch {
      res.status(502).json({
        error: 'GAS returned non-JSON response',
        preview: text.slice(0, 400),
      })
    }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
