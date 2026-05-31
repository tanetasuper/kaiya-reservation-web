export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true })
  }

  const events = req.body?.events || []
  let groupId = null

  for (const event of events) {
    if (event.source?.groupId) {
      groupId = event.source.groupId
      break
    }
  }

  if (groupId && process.env.GAS_URL) {
    try {
      await fetch(
        `${process.env.GAS_URL}?action=setGroupBId&groupId=${encodeURIComponent(groupId)}`,
        { signal: AbortSignal.timeout(4000) }
      )
    } catch {}
  }

  return res.status(200).json({ ok: true })
}
