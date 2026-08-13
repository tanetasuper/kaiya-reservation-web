const ENDPOINT = '/api/gas'

// ログイン成功時に setAdminPassword()/setStaffIdentity() で保持し、admin系API呼び出しに毎回自動で乗せる。
// メモリ上のみに保持（ページ再読み込みではadmin.js側でsessionStorageから復元する）。
// _staffNameが空なら従来通りの共通パスワード（店長として扱う、後方互換）、
// 値があればスタッフ個人アカウントとしてのログインを意味する。
let _adminPassword = ''
let _staffName = ''
export function setAdminPassword(pw) { _adminPassword = pw || ''; _staffName = '' }
export function setStaffIdentity(name, pw) { _adminPassword = pw || ''; _staffName = name || '' }

// 電波の悪い環境などでリクエストが永久に応答待ちにならないよう、上限時間を設けて中断する
const REQUEST_TIMEOUT_MS = 30000

function withTimeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

async function getOnce(action, params) {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS)
  try {
    const r = await fetch(`${ENDPOINT}?${qs}`, { signal })
    if (!r.ok) throw new Error('network error')
    return await r.json()
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました')
    throw e
  } finally {
    clear()
  }
}

// GET系（読み取り専用・副作用なし）は、電波の悪い環境やGASのコールドスタート直後の一時的な失敗を
// お客様の目に触れさせないよう、1回だけ自動リトライする（Amazon CEO視点レビューでの提案）。
// POST系（書き込み）は二重送信のリスクがあるため対象外——読み取り専用のGETだけがこの対象になる。
async function get(action, params = {}) {
  try {
    return await getOnce(action, params)
  } catch (e) {
    if (e.message === '通信がタイムアウトしました') throw e // タイムアウトはリトライしても改善しないため即エラー
    await new Promise(resolve => setTimeout(resolve, 500))
    return await getOnce(action, params)
  }
}

async function post(action, body = {}) {
  const { signal, clear } = withTimeout(REQUEST_TIMEOUT_MS)
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      signal,
    })
    if (!r.ok) throw new Error('network error')
    return await r.json()
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました')
    throw e
  } finally {
    clear()
  }
}

// 管理者専用アクション用：毎回保持中のパスワード（＋スタッフ個人ログイン時は名前）を自動で乗せて送信する
async function postAdmin(action, body = {}) {
  return post(action, { ...body, password: _adminPassword, name: _staffName })
}

export const api = {
  // 初期設定（未認証、店舗が未設定の間だけ動く自己ゲート付き。pages/setup.js専用）
  initialSetup: (data) => post('initialSetup', { data }),

  // Customer reads
  checkAvailability: (date, isKasshiki) =>
    get('checkAvailability', { date, isKasshiki }),
  // time: 容量モデルが「時間帯単位」の店舗では、この時間＋滞在時間と重なる予約だけで残席を判定する
  // （「1日単位」の店舗では無視されるので、常に渡しておいてよい）
  getAvailability: (date, time, course, staff) =>
    get('getAvailability', { date, time, course, staff }),
  getMonthAvailability: (year, month) =>
    get('getMonthAvailability', { year, month }),
  // LINE UserIdは永続的な個人識別子のため、GETのクエリ文字列（Vercel/GASのログにURLがそのまま残り、
  // LIFF起動のたびに高頻度で発生する）ではなくPOST本文で送る（getMyReservationsと同じ理由。以前は
  // getMyReservationsだけPOST化され、これと同種のgetCustomerProfileが取り残されていた。ITコンサル
  // 視点レビュー・ラウンド29での指摘）。dispatch()側はGET（params）・POST（body）どちらでも動くよう
  // 後方互換を保っている。
  // idToken：LIFFのliff.getIDToken()が返すJWT。Code.gs側のresolveTrustedLineUserId_がLINEの公開
  // verify APIで検証し、署名済みのsubだけを信頼する（審判団バックログ一括レビュー・ラウンド31での
  // 指摘：CRITICAL。以前はlineUserIdという非秘匿値をそのまま本人証明として信頼していた）。
  // 省略可（未送信時はLINE_CHANNEL_ID未設定の店舗も含め、後方互換の従来方式にフォールバックする）。
  getCustomerProfile: (lineUserId, idToken) =>
    post('getCustomerProfile', { lineUserId, idToken }),
  // 電話番号・氏名は個人情報のため、GETのクエリ文字列（Vercel/GASのログにURLがそのまま残りうる）
  // ではなくPOST本文で送る（ITコンサル視点レビューでの指摘：低重大度だが実害のある情報漏洩）。
  // dispatch()側はGET（params）・POST（body）どちらでも動くよう後方互換を保っている。
  getMyReservations: (lineUserId, phone, name, idToken) =>
    post('myReservations', { lineUserId, phone, name, idToken }),

  // Customer writes
  createReservation: (data) => post('createReservation', { data }),
  // 定期予約（シリーズ予約、データモデル大改修の一部、ユーザー承認済み・2026-08-11）
  createRecurringReservation: (data) => post('createRecurringReservation', { data }),
  cancelSeries: (data) => post('cancelSeries', { data }),
  changeReservation: (data) => post('changeReservation', { data }),
  cancelReservation: (data) => post('cancelReservation', { data }),
  joinWaitlist: (data) => post('joinWaitlist', { data }),
  requestLateChangeOrCancel: (data) => post('requestLateChangeOrCancel', { data }),
  respondToEstimate: (data) => post('respondToEstimate', { data }),

  // Admin - キャンセル待ち
  adminGetWaitlist: () => postAdmin('adminGetWaitlist', {}),
  adminRemoveWaitlist: (id) => postAdmin('adminRemoveWaitlist', { id }),

  // Admin - reservations（毎回パスワード送信）
  adminGetReservations: (filter) =>
    postAdmin('adminGetReservations', { filter }),
  adminAddReservation: (data) =>
    postAdmin('adminAddReservation', { data }),
  adminUpdateReservation: (data) =>
    postAdmin('adminUpdateReservation', { data }),
  adminDeleteReservation: (id, notifyTarget) =>
    postAdmin('adminDeleteReservation', { id, notifyTarget }),
  // 荒天等による当日一斉キャンセル（累積指摘の総棚卸しでの新機能要望、ユーザー承認済み）。
  adminBulkCancelByDate: (date, reason) =>
    postAdmin('adminBulkCancelByDate', { date, reason }),
  // 見積/承認フロー（データモデル大改修の一部、ユーザー承認済み・2026-08-10）。
  adminSetEstimate: (id, amount, note, partsAmount, laborAmount) =>
    postAdmin('adminSetEstimate', { id, amount, note, partsAmount, laborAmount }),
  adminMarkEstimateWorkDone: (id) =>
    postAdmin('adminMarkEstimateWorkDone', { id }),
  adminCancelSeries: (seriesId) =>
    postAdmin('adminCancelSeries', { seriesId }),
  // 削除した予約の復元（ゴミ箱）。誤削除からの復旧手段が無かった（審判団バックログ一括レビューでの指摘）。
  adminGetTrash: () =>
    postAdmin('adminGetTrash', {}),
  adminRestoreReservation: (id) =>
    postAdmin('adminRestoreReservation', { id }),

  // Admin - blocked dates
  adminGetBlockedDates: () =>
    postAdmin('adminGetBlockedDates', {}),
  // 実際の空き判定はスプレッドシートではなくGoogleカレンダーの生の予定を数えて行っているため、
  // 台帳とカレンダーの食い違い（テスト予定の消し忘れ等）を管理画面から診断できるようにする。
  adminGetCalendarEventsForDate: (date) =>
    postAdmin('adminGetCalendarEventsForDate', { date }),
  adminSetBlockedDate: (date, reason) =>
    postAdmin('adminSetBlockedDate', { date, reason }),
  adminRemoveBlockedDate: (date) =>
    postAdmin('adminRemoveBlockedDate', { date }),

  // Admin - seat blocks
  adminGetSeatBlocks: () =>
    postAdmin('adminGetSeatBlocks', {}),
  adminSetSeatBlock: (date, blockedSeats, reason) =>
    postAdmin('adminSetSeatBlock', { date, blockedSeats, reason }),
  adminRemoveSeatBlock: (date) =>
    postAdmin('adminRemoveSeatBlock', { date }),

  // Admin - LINEグループBの候補確認・確定反映（line-webhook.jsが無認証で記録した「候補」を、
  // 管理者が内容を見て確定させるための自己解決フロー。以前は管理画面から呼べず非技術者には
  // 使えなかった＝Meta/Microsoft CEO視点レビューでの指摘）
  adminGetCapturedGroupId: () =>
    postAdmin('getCapturedGroupId', {}),
  adminSetGroupBId: (groupId) =>
    postAdmin('setGroupBId', { groupId }),

  // Admin - 接続設定（CALENDAR_ID／LIFF_ID／STAFF_GROUP_ID／LINE_TOKEN）。GASエディタを開かずに
  // 変更できるようにする（LINEトークンのローテーション等）。getConnectionSettingsはLINE_TOKEN自体を
  // 返さず有無のみ返すため、フォームはlineToken欄を常に空欄から始め、書き換えたい時だけ入力する。
  getConnectionSettings: () =>
    postAdmin('getConnectionSettings', {}),
  saveConnectionSettings: (data) =>
    postAdmin('saveConnectionSettings', { data }),

  // Admin - date-specific hours override
  adminGetDateOverrides: () =>
    postAdmin('adminGetDateOverrides', {}),
  adminSetDateOverride: (date, hours) =>
    postAdmin('adminSetDateOverride', { date, hours }),
  adminRemoveDateOverride: (date) =>
    postAdmin('adminRemoveDateOverride', { date }),

  // Admin - notifications
  adminGetNotifications: () =>
    postAdmin('adminGetNotifications', {}),
  adminMarkNotificationRead: (id) =>
    postAdmin('adminMarkNotificationRead', { id }),

  // Admin - 操作ログ（削除不可、参照専用）
  adminGetAuditLog: () =>
    postAdmin('adminGetAuditLog', {}),

  // Settings
  getSettings: () =>
    get('getSettings'),
  saveSettings: (settings) =>
    postAdmin('saveSettings', { settings }),
  // adminNotifyChannel/adminAlertEmail（店舗オーナー・スタッフ個人の通知先アドレス）は、以前getSettings
  // に混ぜて返していたため、ログイン不要の公開エンドポイント（お客様画面・マニュアルが読み込む）経由で
  // 誰でも読める状態になっていた（ITコンサル視点レビュー・ラウンド26での指摘）。認証必須の別アクションに分離する。
  getAdminNotifySettings: () =>
    postAdmin('getAdminNotifySettings', {}),

  // システム仕様書（/spec）用。開発権限限定の専用パスワード（店舗のADMIN_PASSWORD等とは別軸）。
  // 内容はパスワードが正しい場合のみGAS側から返る（クライアントのJSバンドルには含まれない）。
  getSystemSpec: (password) =>
    post('getSystemSpec', { password }),

  // Admin auth（パスワードは呼び出し側から明示的に渡す）
  checkAdminPassword: (password) =>
    post('checkAdminPassword', { password }),
  changeAdminPassword: (currentPw, newPw) =>
    post('changeAdminPassword', { currentPw, newPw }),
  resetAdminPassword: (code) =>
    post('resetAdminPassword', { code }),
  getRecoveryQuestion: () =>
    get('getRecoveryQuestion'),
  changeRecoveryQA: (currentPw, question, answer) =>
    post('changeRecoveryQA', { currentPw, question, answer }),

  // Admin data
  adminGetCustomerData: () =>
    postAdmin('adminGetCustomerData', {}),
  adminGetAllReservations: (filter) =>
    postAdmin('adminGetAllReservations', { filter }),
  adminGetBusinessSummary: () =>
    postAdmin('adminGetBusinessSummary', {}),

  // 配信設定（FEATURE_SETTINGS）：LINE配信のタイミング・文言・各機能のON/OFF
  getFeatureSettings: () =>
    get('getFeatureSettings'),
  saveFeatureSettings: (settings) =>
    postAdmin('saveFeatureSettings', { settings }),

  // Notification settings
  getNotificationSettings: () =>
    get('getNotificationSettings'),
  saveNotificationSettings: (settings) =>
    postAdmin('saveNotificationSettings', { settings }),

  // System status（通知の自動停止セーフティ）
  getSystemStatus: () =>
    get('getSystemStatus'),
  adminResetSystemStop: () =>
    postAdmin('adminResetSystemStop', {}),

  // スタッフ個人ログイン・アカウント管理（店長のみ管理可）
  staffLogin: (name, password) =>
    post('staffLogin', { name, password }),
  adminGetStaffAccounts: () =>
    postAdmin('adminGetStaffAccounts', {}),
  adminSaveStaffAccount: (accountId, newName, newPassword, role) =>
    postAdmin('adminSaveStaffAccount', { accountId, newName, newPassword, role }),
  adminRemoveStaffAccount: (accountId) =>
    postAdmin('adminRemoveStaffAccount', { accountId }),
}
