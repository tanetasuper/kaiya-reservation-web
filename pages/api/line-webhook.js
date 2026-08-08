import crypto from 'crypto'

// LINEのWebhookは誰でもこのURLにPOSTできるため、署名検証をしないと偽のイベントを送り込める
// （ITコンサル視点レビューでの指摘：groupIdを変えるだけでcaptureGroupIdのレート制限を回避できてしまう）。
// 検証にはリクエストの生バイト列が必要なため、Next.jsの自動JSONパースを無効化して自前で読む。
export const config = { api: { bodyParser: false } }

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// LINE_CHANNEL_SECRETが未設定の環境（まだ移行中の店舗等）では検証をスキップし、以前と同じ
// 挙動のまま動かす（後方互換）。設定済みなら署名不一致のイベントは無視する。
function verifySignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) return true
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true })
  }

  const rawBody = await readRawBody(req)
  if (!verifySignature(rawBody, req.headers['x-line-signature'])) {
    return res.status(200).json({ ok: true })
  }

  let body
  try { body = JSON.parse(rawBody.toString('utf8') || '{}') } catch { body = {} }

  const events = body?.events || []
  let groupId = null

  for (const event of events) {
    if (event.source?.groupId) {
      groupId = event.source.groupId
      break
    }
  }

  if (groupId && process.env.GAS_URL) {
    try {
      // setGroupBIdはパスワード必須のためここでは呼べない（呼ぶと毎回認証失敗になり、管理画面の
      // ログイン失敗カウンタを誤って回してしまう＝Microsoft CEO視点レビューでの指摘）。
      // ここでは認証不要のcaptureGroupIdで「候補」として記録するだけにし、実際にGROUP_B_IDへ
      // 反映するかどうかは管理者がパスワード付きのsetGroupBIdで別途判断する。
      await fetch(
        `${process.env.GAS_URL}?action=captureGroupId&groupId=${encodeURIComponent(groupId)}`,
        { signal: AbortSignal.timeout(4000) }
      )
    } catch {}
  }

  return res.status(200).json({ ok: true })
}
