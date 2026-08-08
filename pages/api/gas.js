export const config = { runtime: 'edge' }

const json = (data, extraHeaders) =>
  new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  })

// 変更頻度が低い「ほぼ静的な設定」の読み取り専用アクションだけ、Vercelのエッジキャッシュを
// 短時間効かせる（無認証・店舗ごとに変わらない共有可能なデータのみが対象。パスワード等を含む
// アクションや、予約可否のようにリアルタイム性が必要なデータ（getMonthAvailability等）は対象外
// ——古いキャッシュを返すと「空いているはずの席が満席に見える／その逆」という実害があるため）。
// s-maxage=60：60秒間はVercelのCDNがGASへ問い合わせずに返す。stale-while-revalidate=300：
// 60秒を過ぎても、裏側で再取得している間は古い値をそのまま出し続ける（見た目上は常に即答）。
const CACHEABLE_GET_ACTIONS = new Set(['getSettings', 'getFeatureSettings'])

export default async function handler(req) {
  const gasUrl = process.env.GAS_URL
  if (!gasUrl) return json({ error: 'GAS_URL not set in environment' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 28000)

  try {
    let response
    let cacheHeaders = null

    if (req.method === 'GET') {
      // 読み取り専用の公開アクション（getSettings等）はクエリ文字列のままGET
      const { searchParams } = new URL(req.url)
      if (CACHEABLE_GET_ACTIONS.has(searchParams.get('action'))) {
        cacheHeaders = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
      }
      response = await fetch(`${gasUrl}?${searchParams.toString()}`, { signal: controller.signal })
    } else {
      // パスワード等を含むアクションはPOST本文として送る（URLクエリ文字列に残さない）。
      // Code.gsのdoPost()は、パース済みのJSONをそのままbodyとして受け取る想定。
      let body = null
      try { body = await req.json() } catch {}
      response = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      })
    }

    clearTimeout(timer)
    const text = await response.text()

    try {
      const parsed = JSON.parse(text)
      // 失敗レスポンス（success:trueでない）はキャッシュしない。一時的な障害・GASクオータ超過等を
      // 60秒間そのまま全員に返してしまうと、障害の見た目の影響範囲・持続時間を不必要に広げてしまうため。
      return json(parsed, (cacheHeaders && parsed && parsed.success) ? cacheHeaders : null)
    } catch {
      return json({ error: 'GAS returned non-JSON', preview: text.slice(0, 300) })
    }
  } catch (err) {
    clearTimeout(timer)
    return json({ error: err.name === 'AbortError' ? 'GASタイムアウト (>28s)' : err.message })
  }
}
