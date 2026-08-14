import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Head from 'next/head'
import Script from 'next/script'
import { api } from '../lib/api'
import { LANGUAGES, makeT, fmtDateLang, fmtMonthDayEn } from '../lib/i18n'

// LIFF IDは店舗（LINEアプリ）ごとに異なるため、Vercelの環境変数NEXT_PUBLIC_LIFF_IDで上書きできるようにする
// （未設定の場合は貝屋和光の既存デプロイをそのまま動かすため、現在の値をフォールバックとして残す）。
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || '2010107032-v35Ka2mS'
const TIME_SLOTS = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']
const STAY_MIN = 150

// 入力画面（selDate/selTime/名前・電話番号・メモ等）はReactのstateのみに保持しており、どこにも
// 永続化していなかった。電波の悪い／低スペックな端末（このランダム客層が使うような機種）でLINEの
// アプリ内ブラウザがバックグラウンドで回線チェック等のためにWebViewプロセスを破棄すると、復帰時に
// ページが最初から再読み込みされ、入力画面まで進んでいた内容（名前・電話番号・日時・コース等）が
// 何の予告もなく全て消えてしまう。確定直前で失うほど実害が大きい（ランダム客層視点レビュー・
// ラウンド44での指摘）。入力画面にいる間だけ内容をsessionStorageへこまめに保存し、復帰時に復元する。
// localStorageではなくsessionStorageを使うのは、タブ（LIFFのWebView）が完全に閉じられれば自動的に
// 消えるため、何日も前の古い入力が別の来店予定と混ざって復元される事故を避けられるから。
const BOOKING_DRAFT_KEY = 'kaiya_booking_draft_v1'
const BOOKING_DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6時間より古い保存内容は日時選択などが現実味を失うため復元しない
// 変更フロー（既存予約の日程・時間・人数を選び直す画面）向けの下書き。新規予約フローと全く同じ理由
// （WebView破棄によるリロードでの入力消失、ランダム客層視点レビュー・ラウンド45での指摘）で追加。
const CHANGE_DRAFT_KEY = 'kaiya_change_draft_v1'

// 検索エンジン向けの構造化データ（JSON-LD）のschema.orgタイプが、業態を問わず常に汎用の'LocalBusiness'
// 固定だった（累積指摘の総棚卸しでの指摘：汎用予約プラットフォーム化の本旨に反する）。管理画面の
// 「業種」設定（businessCategory、未選択なら空文字）から、より具体的なschema.orgタイプへマッピングする。
// 未対応の値・未選択の場合は後方互換で従来通り'LocalBusiness'のまま。
const BUSINESS_CATEGORY_SCHEMA_TYPES = {
  restaurant: 'Restaurant', salon: 'HairSalon', clinic: 'MedicalBusiness',
  repair: 'AutoRepair', rental: 'RentalCarReservation', leisure: 'TouristAttraction',
  lodging: 'LodgingBusiness', fitness: 'ExerciseGym',
}

// Code.gs側のformatEndTimeForDisplay（複数日にわたるレンタル等で日をまたぐ場合に「（+N日）」を付ける
// 実装）が既に存在するのに、お客様画面側のこの関数だけ単純な分加算のみで日またぎに対応しておらず、
// 24時間を超えると「55:30」のような無意味な時刻がそのまま確認画面・変更フローに表示されていた
// （審判団バックログ一括レビューでの指摘）。同じアルゴリズムを移植する。
function addMin(t, m, lang) {
  const [h, mn] = t.split(':').map(Number)
  const tot = h * 60 + mn + m
  const dayOffset = Math.floor(tot / 1440)
  const wrapped = ((tot % 1440) + 1440) % 1440
  const timeStr = `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
  if (dayOffset <= 0) return timeStr
  return timeStr + (lang === 'en' ? ` (+${dayOffset}d)` : `（+${dayOffset}日）`)
}

// コースカード・確認画面で共通利用する所要時間の表示（ランダム顧客層視点レビュー：英語モードで
// 「約1時間30分」がノーガードで残っており、コースカードと確認画面（最終ステップ）で未翻訳だった）。
function fmtDuration(min, lang) {
  const h = Math.floor((min || 150) / 60)
  const m = (min || 150) % 60
  if (lang === 'en') return `approx. ${h} hr${m > 0 ? ` ${m} min` : ''}`
  return `約${h}時間${m > 0 ? m + '分' : ''}`
}

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// JSON-LD用のOpeningHoursSpecificationを、残席計算に既に使っているdailyHoursから組み立てる
// （設定が無い店舗ではnullを返し、営業時間の構造化データ自体を省略する）
function buildOpeningHoursSpec(dailyHours) {
  if (!dailyHours) return null
  const spec = []
  for (let dow = 0; dow <= 6; dow++) {
    const dayH = dailyHours[String(dow)]
    if (!dayH) continue
    const dayName = 'https://schema.org/' + SCHEMA_DAYS[dow]
    if (dayH.lunchEnabled && dayH.lunchStart && dayH.lunchEnd) {
      spec.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayName, opens: dayH.lunchStart, closes: dayH.lunchEnd })
    }
    if (dayH.dinnerEnabled && dayH.dinnerStart && dayH.dinnerEnd) {
      spec.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: dayName, opens: dayH.dinnerStart, closes: dayH.dinnerEnd })
    }
  }
  return spec.length > 0 ? spec : null
}

function telHref(phone) { return 'tel:' + (phone || '').replace(/[^0-9]/g, '') }

// これまでフォーム全体に<form>タグが無く、電話番号・メールアドレスとも「空欄でないか」しか
// チェックしていなかった。特にメールアドレスは、LINEを使わないゲストのお客様にとって唯一の
// 確認・変更・キャンセル手段としてこの画面自身が案内しているにもかかわらず、typo（例：
// test@gmial.con）でも何のエラーも出さずに送信できてしまい、確認メールが届かないまま気づけない
// 実害があった（ランダム客層視点レビュー・ラウンド29での指摘）。バックエンド（isValidEmailFormat）
// と同じ緩やかな形式チェックのみ行う（実在確認まではしない）。
function isValidEmailFormat(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim()) }
// このシステムは英語モードも提供しており海外のお客様（国番号付き電話番号）も利用しうるため、日本の
// 携帯・固定電話の桁数（9〜11桁）に限定すると正当な国際電話番号を誤って拒否しかねない。国際電話番号の
// 標準的な最大桁数（E.164、国番号込みで最大15桁）を上限に、明らかな入力ミス・桁不足だけを弾く
// 緩やかな範囲にする（厳密な市外局番・番号帯の検証はしない）。
function isValidPhoneFormat(phone) { const digits = (phone || '').replace(/[^0-9]/g, ''); return digits.length >= 8 && digits.length <= 15 }

// LINEアプリ内ブラウザ（LIFF）では通常の<a target="_blank">が確実に開くとは限らない（LINE公式の
// 推奨はliff.openWindow()の使用）。プライバシーページへのリンクが同意チェックの唯一の確認手段のため、
// アプリ内では専用APIで開き、それ以外（PC・外部ブラウザ）では通常のリンク遷移に任せる
// （Google CEO視点レビューでの指摘）。
function openPrivacyLink(e) {
  if (typeof window !== 'undefined' && window.liff && window.liff.isInClient && window.liff.isInClient()) {
    e.preventDefault()
    // isInClient()はUser-Agent判定のみで、liff.init()が実際に完了しているかは見ていない。
    // init()がタイムアウト・失敗していてもwindow.liffはグローバルに残るため、openWindow()が
    // 例外を投げてリンクが完全に死ぬ場合がある——唯一の同意確認手段なので、失敗時は通常の
    // ページ遷移にフォールバックする（Google CEO視点レビューでの指摘）。
    try {
      window.liff.openWindow({ url: window.location.origin + '/privacy', external: true })
    } catch {
      window.location.href = '/privacy'
    }
  }
}

function formatTimeSlotRanges(slots) {
  if (!slots || slots.length === 0) return ''
  const ranges = []
  let start = slots[0], prev = slots[0]
  for (let i = 1; i < slots.length; i++) {
    const [ph, pm2] = prev.split(':').map(Number)
    const [ch, cm] = slots[i].split(':').map(Number)
    if ((ch * 60 + cm) - (ph * 60 + pm2) > 30) {
      ranges.push(start + '〜' + prev)
      start = slots[i]
    }
    prev = slots[i]
  }
  ranges.push(start + '〜' + prev)
  return ranges.join(' / ')
}

// yyyy/MM/dd or yyyy-MM-dd → M月D日（曜）
function fmtDate(ymd) {
  if (!ymd) return ''
  const parts = String(ymd).replace(/\//g, '-').split('-')
  if (parts.length !== 3) return String(ymd)
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
  const w = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}月${d.getDate()}日（${w[d.getDay()]}）`
}

// Date → yyyy-MM-dd
function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// yyyy-MM-dd or yyyy/MM/dd → Date (local midnight)
function parseDate(s) {
  const parts = String(s).replace(/\//g, '-').split('-')
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
}

// 定期予約（シリーズ予約）：選択した来店日を1回目として、frequency（毎週/隔週/毎月/カスタム）に従って
// count回分の日付リストを組み立てる（サーバー側は日付の計算ロジックを持たず、指定された日付の分だけ
// createReservationを繰り返すだけに専念する設計。Code.gsのcreateRecurringReservationのコメント参照）。
// customIntervalWeeks: frequency==='custom'の場合のみ使う、何週間隔か（美容院の6〜8週間隔等、
// 毎週/隔週/毎月の3択に収まらない利用パターンが業種経営者陣視点レビュー・2026-08-11で指摘された）。
function buildRecurringDates(firstDate, frequency, count, customIntervalWeeks) {
  const dates = [firstDate]
  const base = parseDate(firstDate)
  for (let i = 1; i < count; i++) {
    let d
    if (frequency === 'monthly') {
      // d.setMonth(d.getMonth()+i)は、開始日が29〜31日の場合に月によって存在しない日付へロールオーバー
      // してしまい（例：1/31 + 1ヶ月 → 2/31は存在しないため自動的に3/3になる）、「毎月同じ日」という
      // お客様の意図と全く違う不規則な日付列になる実バグがあった（イーロン・Google CEO・ランダム客層の
      // 3視点が独立に発見・ラウンド35）。対象月に開始日と同じ日が存在しない場合は、その月の末日に
      // 揃える（月をまたぐたびに日付がどんどんズレていく副作用を避けるため、常に「元の開始日」を
      // 基準に計算する）。
      const targetMonthIndex = base.getMonth() + i
      const targetYear = base.getFullYear() + Math.floor(targetMonthIndex / 12)
      const targetMonth = ((targetMonthIndex % 12) + 12) % 12
      const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
      d = new Date(targetYear, targetMonth, Math.min(base.getDate(), daysInTargetMonth))
    } else {
      d = new Date(base)
      if (frequency === 'weekly') d.setDate(d.getDate() + 7 * i)
      else if (frequency === 'biweekly') d.setDate(d.getDate() + 14 * i)
      else if (frequency === 'custom') d.setDate(d.getDate() + 7 * (customIntervalWeeks || 1) * i)
    }
    dates.push(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`)
  }
  return dates
}

// "HH:mm" はそのまま / "1899-12-30T08:30:00.000Z" のようなISO文字列 → getHours/getMinutes でHH:mm
function fmtTime(t) {
  if (!t) return ''
  if (/^\d{1,2}:\d{2}$/.test(String(t))) return String(t)
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 予約可能な最も近い日を計算
function computeDateMin(now, hols) {
  const h = hols || {}
  for (let i = 1; i <= 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const ymd = toYMD(d)
    const dow = d.getDay()
    const isHol = !!h[ymd.replace(/-/g, '/')]
    const isSatSun = dow === 0 || dow === 6
    let dl
    if (isHol) {
      dl = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 3, 22, 0, 0, 0)
    } else if (isSatSun) {
      dl = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((dow + 3) % 7), 22, 0, 0, 0)
    } else {
      dl = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 2, 22, 0, 0, 0)
    }
    if (now < dl) return ymd
  }
  return toYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14))
}

function generateSlots(tr) {
  const slots = []
  const [sh, sm] = tr.start.split(':').map(Number)
  const [eh, em] = tr.end.split(':').map(Number)
  let cur = sh * 60 + sm
  const end = eh * 60 + em
  while (cur < end) {
    slots.push(`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`)
    cur += 30
  }
  return slots
}

function TimeGrid({ value, onChange, slots }) {
  // slotsが未指定（undefined/null）の場合のみ既定の時間帯にフォールバックする。空配列（[]）は
  // 「その日・その条件では提供時間が無い」という正しい計算結果であり、そのまま「選択肢が無い」
  // 状態として扱う——以前はここで空配列もフォールバック対象にしてしまい、computeTimeSlotsForDateの
  // 修正（診療時間外に飲食店のディナー帯を出さない対応）がこの1つ下のレイヤーで無効化されていた
  // （PMO視点レビューで発見：ラウンド12の修正がUI層で打ち消されていた）。
  const list = slots || TIME_SLOTS
  return (
    <div className="t-grid">
      {list.map((s) => (
        <button key={s} className={`t-btn${value === s ? ' sel' : ''}`} aria-pressed={value === s} onClick={() => onChange(s)}>
          {s}
        </button>
      ))}
    </div>
  )
}

const CAL_WEEK = ['日','月','火','水','木','金','土']
// 広告枠（任意・将来の収益化向け）。店舗が設定していない、またはこの場所を選んでいない限り何も表示しない。
// 店側が入力する画像URL（店舗紹介写真・コース写真・広告バナー）は、大きすぎる画像がそのまま配信されると
// 表示速度のボトルネックになるため、無料の画像最適化プロキシ（wsrv.nl、サインアップ不要）を経由させて
// 自動的に指定サイズ・webpに縮小する。プロキシ自体が落ちている場合に画像が全く出なくなるのを避けるため、
// 失敗時は元のURLに1回だけフォールバックする（onOptimizedImageError参照）。
function optimizedImageUrl(url, width) {
  if (!url) return url
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&q=75&output=webp`
}
function onOptimizedImageError(e, rawUrl) {
  if (e.target.dataset.fallenBack) { e.target.style.display = 'none'; return }
  e.target.dataset.fallenBack = '1'
  e.target.src = rawUrl
}

function AdBannerSlot({ adBanner, place, style, lang }) {
  if (!adBanner.enabled || !(adBanner.imageUrl || adBanner.text)) return null
  if (!(adBanner.placements || ['done']).includes(place)) return null
  // 辞書には「広告」→「Ad」の訳が既に用意されていたが、このコンポーネントがlang/t()を
  // 一切受け取っていなかったため実際には使われず、英語モードでも常に日本語のまま表示されていた
  // （ランダム客層視点レビューでの指摘：訳自体は存在するのに配線漏れで無効化されていたケース）。
  const adLabel = lang === 'en' ? 'Ad' : '広告'
  return (
    <div style={style}>
      <div style={{ fontSize: 10, letterSpacing: '0.05em', color: 'var(--hint)', marginBottom: 4 }}>{adLabel}</div>
      <a href={adBanner.linkUrl || undefined} target={adBanner.linkUrl ? '_blank' : undefined} rel={adBanner.linkUrl ? 'noopener noreferrer sponsored' : undefined}
        style={{ display: 'block', textDecoration: 'none' }}
        onClick={e => { if (!adBanner.linkUrl) e.preventDefault() }}>
        {adBanner.imageUrl && (
          <img src={optimizedImageUrl(adBanner.imageUrl, 800)} alt={adBanner.text || adLabel} loading="lazy" decoding="async"
            style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }}
            onError={e => onOptimizedImageError(e, adBanner.imageUrl)} />
        )}
        {adBanner.text && <div style={{ fontSize: 12, color: 'var(--hint)', marginTop: 6 }}>{adBanner.text}</div>}
      </a>
    </div>
  )
}

function CustomerCalendar({ year, month, monthAvail, dateMin, dateMax, selected, onSelect, onPrev, onNext, loading, lang }) {
  const t = makeT(lang)
  const todayYMD = toYMD(new Date())
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const info = monthAvail[ymd.replace(/-/g,'/')] || {}
    const isPast = ymd < dateMin
    const isFuture = dateMax && ymd > dateMax
    const isUnavailable = info.status === 'blocked' || info.status === 'full'
    const isDisabled = isPast || isFuture || isUnavailable
    cells.push({ d, ymd, info, isDisabled, isPast, isFuture, isUnavailable, isSelected: ymd === selected, isToday: ymd === todayYMD })
  }

  // 以前はisDisabled（過去日・受付終了日・実際の満席/休業をすべて合わせた条件）だけで判定しており、
  // 単に「今日より前の日付」「予約可能範囲外の未来日」でも一律「満席・休業」という読み上げラベルが
  // 付いていた。晴眼者には見た目上テキストが空欄（textが''）なので違和感が無いが、スクリーンリーダー
  // 利用者には実際の空席状況と無関係な誤った理由が伝わっていた（審判団バックログ一括レビューでの指摘）。
  // 過去日・範囲外の未来日は理由を分けたラベルにする。
  function mark(cell) {
    const { info, isPast, isFuture, isUnavailable } = cell
    if (isUnavailable) return { text:'✕', color:'var(--hint)', label:t('満席・休業') }
    if (isPast) return { text:'', color:'var(--hint)', label:t('過去の日付のため選択できません') }
    if (isFuture) return { text:'', color:'var(--hint)', label:t('予約可能な期間外です') }
    if (info.status === 'few')  return { text:'△', color:'var(--kwarn-title)', label:t('残席わずか') }
    if (info.status === 'open') return { text:'○', color:'var(--green)', label:t('空きあり') }
    return { text:'', color:'transparent', label:'' }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        {/* 月送りの←→もアイコンのみのボタンで、旧スタイル（padding:8px 16pxのみ）だと実際の高さが
            フォントサイズ17px相当（約36px）にしかならず44pxに届いていなかった。ノーツ閉じるボタン
            と同じ理由で見落とされていたため、他のアイコンボタンと同じ44×44の最小タッチターゲットに
            揃える（Appleデザインチーム視点レビュー・ラウンド46での指摘）。 */}
        <button onClick={onPrev} disabled={loading} aria-label={t('前の月')} style={{ padding:'8px 16px', background:'var(--input-bg)', border:'none', borderRadius:8, fontSize:17, minWidth:44, minHeight:44, display:'inline-flex', alignItems:'center', justifyContent:'center', cursor: loading ? 'default' : 'pointer', color: loading ? 'var(--disabled-border)' : 'var(--sub)' }}>←</button>
        <span style={{ fontWeight:'bold', fontSize:16, color:'var(--text)' }}>{lang === 'en' ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month]} ${year}` : `${year}年${month+1}月`}</span>
        <button onClick={onNext} disabled={loading} aria-label={t('次の月')} style={{ padding:'8px 16px', background:'var(--input-bg)', border:'none', borderRadius:8, fontSize:17, minWidth:44, minHeight:44, display:'inline-flex', alignItems:'center', justifyContent:'center', cursor: loading ? 'default' : 'pointer', color: loading ? 'var(--disabled-border)' : 'var(--sub)' }}>→</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:4 }}>
        {(lang === 'en' ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : CAL_WEEK).map((w,i) => (
          <div key={w} style={{ textAlign:'center', fontSize:13, fontWeight:'bold', padding:'3px 0',
            color: i===0?'var(--red)':i===6?'var(--sat-blue)':'var(--hint)' }}>{w}</div>
        ))}
      </div>
        {/* 呼び出し側（親コンポーネント）が同じloadingフラグでこのカレンダー全体に不透明のオーバーレイを
            重ねて「読み込み中」を表示するため、ここでは常にグリッド自体を描画する（以前は読み込み中に
            この位置にも別の「読み込み中...」テキストを出していたが、外側のオーバーレイに常に隠れて
            実際には表示されない死んだコードだったため削除した）。 */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3 }}>
          {cells.map((cell, i) => {
            if (cell === null) return <div key={`e${i}`}/>
            const mk = mark(cell)
            const colIdx = i % 7
            return (
              <button key={cell.ymd} disabled={cell.isDisabled}
                onClick={() => onSelect(cell.isSelected ? '' : cell.ymd)}
                aria-pressed={cell.isSelected}
                aria-label={lang === 'en'
                  ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month]} ${cell.d}${mk.label ? ', ' + mk.label : ''}${cell.isSelected ? ', selected' : ''}`
                  : `${month+1}月${cell.d}日${mk.label ? '　' + mk.label : ''}${cell.isSelected ? '　選択中' : ''}`}
                style={{
                  padding:'4px 2px', textAlign:'center', fontSize:15,
                  border: cell.isSelected ? '2.5px solid var(--green)' : cell.isToday ? '2px solid var(--hint)' : '1px solid transparent',
                  borderRadius:6,
                  background: cell.isSelected ? 'var(--tag-bg)' : 'transparent',
                  color: cell.isDisabled ? 'var(--disabled-text)' : colIdx===0 ? 'var(--red)' : colIdx===6 ? 'var(--sat-blue)' : 'var(--text)',
                  cursor: cell.isDisabled ? 'default' : 'pointer',
                  minHeight:52, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                }}>
                <span style={{ fontWeight: cell.isToday?'bold':'normal', lineHeight:1.2 }}>
                  {cell.d}{cell.isSelected ? ' ✓' : ''}
                </span>
                <span style={{ fontSize:14, fontWeight:'bold', color:mk.color, lineHeight:1.3 }}>{mk.text}</span>
              </button>
            )
          })}
        </div>
      <div style={{ display:'flex', gap:14, marginTop:10, fontSize:13, flexWrap:'wrap' }}>
        <span style={{ color:'var(--green)', fontWeight:'bold' }}>○ {t('空きあり')}</span>
        <span style={{ color:'var(--kwarn-title)', fontWeight:'bold' }}>△ {t('残席わずか')}</span>
        {/* 以前は凡例だけvar(--red)（赤）だったが、実際のマーク（mark()関数）はvar(--hint)（グレー）で
            描画しており、凡例と実際の色が食い違っていた（審判団バックログ一括レビューでの指摘）。
            実際のマーク色に合わせる。 */}
        <span style={{ color:'var(--hint)', fontWeight:'bold' }}>✕ {t('満席/休業')}</span>
      </div>
    </div>
  )
}

export default function Home() {
  const [screen, setScreen] = useState('loading')
  // 電波の悪い環境・サーバー起動直後等で読み込みが長引く場合、無反応に見えて不安にならないよう
  // 一定時間後に案内文を追加表示する（タイムアウト自体は変更せず、心理的な待ち時間の体感のみ改善する）。
  const [longWait, setLongWait] = useState(false)
  useEffect(() => {
    if (screen !== 'loading') { setLongWait(false); return }
    const timer = setTimeout(() => setLongWait(true), 6000)
    return () => clearTimeout(timer)
  }, [screen])
  const [profile, setProfile] = useState(null)
  // LINEユーザーIDの暗号学的検証（Code.gs側resolveTrustedLineUserId_）に使う、LIFF発行のIDトークン
  // （JWT）。以前はprofile.userId（秘密情報ではなく、devtools等で第三者にも見える値）だけをそのまま
  // 「本人証明」としてサーバーへ送っており、他人のuserIdを知るだけでなりすましが可能だった
  // （Apple CEO・ITコンサル各視点が独立発見・審判団バックログ一括レビュー・ラウンド31でCRITICAL判定）。
  const [idToken, setIdToken] = useState('')
  const [isGuestMode, setIsGuestMode] = useState(false)
  const [dateMin, setDateMin] = useState('')
  const [dateMax, setDateMax] = useState('')

  // 祝日データ（初回日付選択時に取得）
  const [holidays, setHolidays] = useState({})
  const holidaysFetchedRef = useRef(false)

  // 空席情報
  const [avail, setAvail] = useState(null)
  const [availLoading, setAvailLoading] = useState(false)
  const [availErr, setAvailErr] = useState('')
  // 日付/時間/人数を素早く切り替えると、先に発行した古いリクエストの応答が後発リクエストより遅れて
  // 戻り、新しい選択の結果を古い応答が上書きしてしまう「レース状態」が起こり得た。呼び出しごとに
  // 連番のリクエストIDを発行し、応答が戻った時点で「自分が最新のリクエストか」を確認してから
  // state更新する（古い応答は無視する）ガードを追加する（審判団指摘対応）。
  const availReqIdRef = useRef(0)

  // コース設定（管理画面から取得）。取得前・取得失敗時に特定店舗の実データが見えてしまわないよう、
  // 汎用的な空配列を既定にする（2026-08-08、実機テストを受けての一般化対応）。
  const [settingsCourses, setSettingsCourses] = useState([])
  const [selCourse, setSelCourse] = useState(0)
  // 下書き復元（restoreBookingDraftIfAny）専用。selCourseは配列の「並び順」を指すインデックスに
  // 過ぎず、コース名やIDのような安定した識別子ではない（admin.js側もcourses配列を並び替え・
  // 廃止（discontinued）で操作しており、位置は保存されない）。バックグラウンド中（最大6時間、
  // BOOKING_DRAFT_MAX_AGE_MS）に店舗側がコースの並び替え・追加・廃止を行うと、復元時に取り直す
  // 最新のvisibleCoursesでは同じインデックスが別のコース（価格・所要時間・提供時間帯が異なりうる）を
  // 指してしまい、気づかれないまま送信（createReservation、1511行目付近）されるコースがすり替わる
  // 恐れがあった（Google CEO視点レビュー・ラウンド46での指摘）。位置ではなく名前で復元し直せるよう、
  // 「復元待ちのコース名」をここに一時的に保持する（visibleCoursesが確定し次第、下のuseEffectで
  // 名前が一致するインデックスへ解決する）。
  const [pendingCourseName, setPendingCourseName] = useState('')
  // ランチ終了時刻の既定値をdailyHours方式（'13:00'、サーバー側defaultDailyHours()）と統一
  // （Microsoft CEO視点レビュー・ラウンド38での指摘、admin.jsのdefTimeRangesと同じ修正）。
  // labelは現状このファイル内では表示に使われていない（type/start/endのみ参照）が、admin.js側の
  // defTimeRangesと同じ既定値配列という位置づけのため、ラベルだけ食い違ったままにしておくと
  // 将来labelを表示に使い始めた際に飲食店専用文言が復活する（業種経営者陣視点レビュー・第46回：
  // admin.jsの「ランチ」「ディナー」表示を「昼の部」「夜の部」に一般化した際に発見）。
  const [settingsTimeRanges, setSettingsTimeRanges] = useState([
    { type:'lunch', label:'昼の部', start:'11:30', end:'13:00' },
    { type:'dinner', label:'夜の部', start:'17:00', end:'21:00' },
  ])
  const [settingsDailyHours, setSettingsDailyHours] = useState({})
  const [settingsDateOverrides, setSettingsDateOverrides] = useState({})
  const [bookingNotes, setBookingNotes] = useState('')
  const [showNotesPopup, setShowNotesPopup] = useState(false)
  const defCutoff = { daysBefore:2, time:'22:00' }
  const [settingsCutoffRules, setSettingsCutoffRules] = useState({
    '0':{ daysBefore:3, time:'22:00' }, '1':defCutoff, '2':defCutoff,
    '3':defCutoff, '4':defCutoff, '5':defCutoff,
    '6':{ daysBefore:2, time:'22:00' }, 'holiday':{ daysBefore:3, time:'22:00' },
  })
  // 店舗側が配信設定でON/OFFできる機能フラグ（キャンセル待ち・期限後LINE依頼）。既定は両方trueとして
  // 取得前もボタンを表示し、取得後にOFFなら隠す（取得失敗時に誤って機能を消してしまわないようにする）。
  const [featureFlags, setFeatureFlags] = useState({ waitlistEnabled: true, lateRequestEnabled: true, kasshikiEnabled: true, recurringBookingEnabled: true })
  // 店名・電話番号等は設定（getSettings）から取得する。取得前・取得失敗時は特定店舗の実データが
  // 表示され続けないよう、汎用的な空値を既定にする（2026-08-08、実機テストを受けての一般化対応：
  // 以前は取得失敗時に貝屋和光の実際の電話番号・紹介文が無期限に表示され続けてしまっていた）。
  const [bizName, setBizName] = useState('店舗')
  const [bizTagline, setBizTagline] = useState('')
  const [bizAddress, setBizAddress] = useState('')
  const [businessCategory, setBusinessCategory] = useState('')
  const [storeImageUrl, setStoreImageUrl] = useState('')
  const [bizPhone, setBizPhone] = useState('')
  const [q1Options, setQ1Options] = useState(['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他'])
  const [q3Options, setQ3Options] = useState(['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他'])
  // 以前はq1/q3が固定文字列'その他'と一致するかどうかで自由記入欄の表示を判定していたが、店舗が
  // 管理画面でこの選択肢のラベル文言自体を自由に変更・削除できるため、「その他」という語を変更されると
  // 自由記入欄が無音で出なくなっていた（審判団バックログ一括レビューでの指摘）。全11業態プリセットが
  // 例外なく「自由記入用の選択肢」を配列の最後に置く規約になっているため、文字列の中身ではなく
  // 配列内の位置（最後の要素かどうか）で判定する。
  function isQ1Other(val) { return !!val && q1Options.length > 0 && val === q1Options[q1Options.length - 1] }
  function isQ3Other(val) { return !!val && q3Options.length > 0 && val === q3Options[q3Options.length - 1] }
  // 質問文言自体も店舗側で変更できるようにする（選択肢=q1Options/q3Optionsとは別。ユーザー指摘・2026-08-08）。
  const [q1Question, setQ1Question] = useState('ご利用目的（任意）')
  const [q3Question, setQ3Question] = useState('どのように当店を知りましたか（任意）')
  // 'course'=コース制（懐石・フルコース等、既定）／'simple'=コース選択なし（定食・a-la-carte等の業態向け）
  const [bookingMode, setBookingMode] = useState('course')
  // 選択項目の呼び方（飲食店「コース」／サロン「サービス」／自動車修理「修理プラン」／病院「診療内容」等、業態に合わせて変更できる）
  const [itemLabel, setItemLabel] = useState('コース')
  const [itemIcon, setItemIcon] = useState('🍽')
  // 広告枠（任意・将来の収益化向け）：店舗が設定していない限り何も表示されない
  const [adBanner, setAdBanner] = useState({ enabled: false, imageUrl: '', text: '', linkUrl: '', placements: ['done'] })
  const [capacityModel, setCapacityModel] = useState('daily')
  // 「担当者」の呼び方・残数を数える単位は業態によって変わる（導入ウィザードで設定）。
  // admin.js・manual.jsは既に対応済みだったが、お客様が実際に見るこの画面だけ配線が漏れていた
  // （テスト全部隊レビューで指摘）。
  const [staffLabel, setStaffLabel] = useState('担当者')
  const [countUnit, setCountUnit] = useState('名')
  // 「ご来店」が全業態共通で使われ続けていた（クリニックの「ご来院」、宿泊業の「ご来館」等）。
  // staffLabel/countUnitと同じ考え方で店舗設定から取得する（累積指摘の総棚卸しでの指摘、ユーザー承認済み）。
  const [visitNoun, setVisitNoun] = useState('来店')
  const [visitNounEn, setVisitNounEn] = useState('visit')
  const [guestCountEnabled, setGuestCountEnabled] = useState(true)
  const [fixedGuestCount, setFixedGuestCount] = useState('1')
  const [companionInfoEnabled, setCompanionInfoEnabled] = useState(true)
  const [emailCollectionEnabled, setEmailCollectionEnabled] = useState(false)
  const [email, setEmail] = useState('')
  const [enabledLanguages, setEnabledLanguages] = useState(['ja'])
  const [lang, setLang] = useState('ja')
  const [staffAssignmentEnabled, setStaffAssignmentEnabled] = useState(false)
  const [staffRoster, setStaffRoster] = useState([])
  const [selStaff, setSelStaff] = useState('')
  const [preferredStaff, setPreferredStaff] = useState('')
  // 高単価層レビュー対応：リピーターが前回指名した担当者が今も在籍していれば、再訪時に自動で指名を引き継ぐ
  // （プロフィール取得・設定取得は非同期で順不同に届くため、両方揃った時点で一度だけ適用する）
  useEffect(() => {
    if (preferredStaff && staffRoster.some(s => s.name === preferredStaff)) {
      setSelStaff((cur) => cur || preferredStaff)
    }
  }, [preferredStaff, staffRoster])

  // <html lang>を選択言語に同期する（_document.jsは"ja"固定のため、英語表示時にスクリーンリーダー・
  // 検索エンジンへ言語が正しく伝わらないというGoogle CEO視点レビューでの指摘への対応）
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang || 'ja'
  }, [lang])

  // 月別カレンダー
  const [calYear,          setCalYear]          = useState(new Date().getFullYear())
  const [calMonth,         setCalMonth]         = useState(new Date().getMonth())
  const [monthAvail,       setMonthAvail]       = useState({})
  const [monthAvailLoading,setMonthAvailLoading]= useState(true)
  const monthAvailCacheRef = useRef({})

  // 予約フォーム
  const [selDate, setSelDate] = useState('')
  const [selGuest, setSelGuest] = useState('')
  const [isKasshiki, setIsKasshiki] = useState(false)
  const [isKonsult, setIsKonsult] = useState(false)
  const [showKasshikiWarning, setShowKasshikiWarning] = useState(false)
  const [selTime, setSelTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [q1, setQ1] = useState('')
  const [q1Other, setQ1Other] = useState('')
  const [q3, setQ3] = useState('')
  const [q3Other, setQ3Other] = useState('')
  const [notes, setNotes] = useState('')
  // 以前は既定で折りたたんでいたが、ユーザー指示により「任意の質問（ご指名・ご利用目的等）は
  // 初めから表示しておく」方針に変更（2026-08-08）。
  const [showOptional, setShowOptional] = useState(true)
  const [companions, setCompanions] = useState([{ name: '', allergy: '' }])
  const [inputErr, setInputErr] = useState('')
  const [cfErr, setCfErr] = useState('')
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState({ detail: '', id: '', pending: false, error: '', backScreen: 'confirm', title: 'ご予約を承りました' })

  // 定期予約（シリーズ予約、データモデル大改修の一部、ユーザー承認済み・2026-08-11）。既定はOFFで、
  // 通常の単発予約フロー（date/time/guests等の既存state・画面遷移）は一切変更しない、確認画面での
  // 追加オプションとして実装する。貸切・大人数相談（isKasshiki/isKonsult）では選べないようにする
  // （買い切り・要相談枠を定期的に繰り返す想定が薄く、組み合わせると案内が複雑になるため）。
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurringFrequency, setRecurringFrequency] = useState('weekly') // 'weekly' | 'biweekly' | 'monthly' | 'custom'
  const [recurringCount, setRecurringCount] = useState(4)
  // カスタム頻度（美容院の6〜8週間隔等、業種経営者陣視点レビュー・2026-08-11で指摘された既存3択の隙間）。
  const [customIntervalWeeks, setCustomIntervalWeeks] = useState(6)

  // キャンセル待ち
  const [wlSubmitting, setWlSubmitting] = useState(false)
  const [wlDone, setWlDone] = useState(false)
  const [wlErr, setWlErr] = useState('')
  // 時間帯・担当者制の業態（capacityModel!=='daily'）では、キャンセル待ちが日付単位でしか動いておらず、
  // 無関係な時間・担当者の空きでも通知が飛んでしまっていた（業種経営者陣視点レビュー・ラウンド30での
  // 指摘、ユーザー承認済み）。お客様自身に「厳密にこの時間・担当者」か「同じ日ならいつでも」かを
  // 選んでもらう。'daily'業態（元々日付単位で正しい設計）では常に'anyTime'で送る。
  const [wlNotifyCondition, setWlNotifyCondition] = useState('anyTime')

  // 予約一覧
  const [myRes, setMyRes] = useState([])
  const [myResLoading, setMyResLoading] = useState(false)
  const [cancelId, setCancelId] = useState(null)
  const [cancelingId, setCancelingId] = useState(null)
  const [cancelErr, setCancelErr] = useState('')
  // 見積/承認フロー（データモデル大改修の一部、2026-08-10）
  const [estimateRespondingId, setEstimateRespondingId] = useState(null)
  const [estimateRespondErr, setEstimateRespondErr] = useState('')
  // estimateRespondErrは全予約カードで共有のstateのため、複数の予約が同時に見積応答待ちの場合
  // （車修理工場等、複数台が同時に見積待ちになりうる業態で現実的）、片方の失敗が無関係な別の
  // カードにも表示されてしまっていた（ランダム客層視点レビュー・ラウンド39での指摘）。
  // エラーがどの予約に対するものかを併せて記録し、該当カードだけに表示する。
  const [estimateRespondErrId, setEstimateRespondErrId] = useState(null)
  // 承諾・辞退とも、単発キャンセルと同じ「本当に良いか」の一段階確認を挟む（テスト全部隊レビュー・
  // 2026-08-11で、確認無しの即時実行だと誤操作リスクが高いと複数視点から指摘されたための対応）。
  const [estimateConfirm, setEstimateConfirm] = useState(null) // { id, accept } | null
  // 定期予約（シリーズ予約）：まとめてキャンセル
  const [seriesCancelingId, setSeriesCancelingId] = useState(null)
  const [seriesCancelErr, setSeriesCancelErr] = useState('')
  // seriesCancelErrと同じ理由（ランダム客層視点レビュー・ラウンド39での指摘）：複数の定期予約シリーズ、
  // あるいは定期予約と無関係な単発予約が同じマイ予約一覧に並ぶ場合、片方のシリーズキャンセル失敗が
  // 無関係な予約カードにも表示されてしまっていた。
  const [seriesCancelErrId, setSeriesCancelErrId] = useState(null)
  // シリーズ一括キャンセルは単発キャンセルより影響範囲が大きい（最大8件）のに確認ダイアログが
  // 無かった（テスト全部隊レビュー・2026-08-11で複数視点から指摘）。単発と同じ二段階確認にする。
  const [seriesCancelConfirmId, setSeriesCancelConfirmId] = useState(null)
  // 単発キャンセル・シリーズ一括キャンセル・見積承諾/辞退の3つの「本当に良いか」確認ブロックは、
  // 出現してもフォーカスが移動せず、画面を見ていない（スクリーンリーダー利用中の）お客様には
  // 出現したこと自体が伝わらなかった（Appleデザインチーム視点レビュー・ラウンド43での指摘）。
  // 各予約カードは一覧内でmapされるため単一のuseRefでは対象を一意に特定できず、
  // res.id等をキーにした登録用マップに「はい」ボタンのDOM要素を集約し、対応するidステートが
  // セットされた時だけそのボタンへフォーカスを移す（見た目・既存の確認フロー自体は変更しない）。
  const cnlYesRefs = useRef({})
  useEffect(() => { if (cancelId != null) cnlYesRefs.current[`cancel-${cancelId}`]?.focus() }, [cancelId])
  useEffect(() => { if (seriesCancelConfirmId != null) cnlYesRefs.current[`series-${seriesCancelConfirmId}`]?.focus() }, [seriesCancelConfirmId])
  useEffect(() => { if (estimateConfirm != null) cnlYesRefs.current[`estimate-${estimateConfirm.id}`]?.focus() }, [estimateConfirm])
  const [myResErr, setMyResErr] = useState('')
  const [myResNeedsPhone, setMyResNeedsPhone] = useState(false)
  const [myResPhoneInput, setMyResPhoneInput] = useState('')
  const [myResPhoneUsed, setMyResPhoneUsed] = useState('')
  const [myResNameInput, setMyResNameInput] = useState('')
  const [myResNameUsed, setMyResNameUsed] = useState('')
  // 自分のキャンセル待ち登録一覧（マイ予約と対になる画面、Meta CEO視点レビュー・審判団ラウンド46で新設）。
  // 取得失敗はマイ予約本体の表示を妨げない「あくまで付随情報」のため、専用のエラー表示は持たず
  // 単に空リストのまま表示しない（お客様が困る失敗モードはマイ予約自体の失敗の方であり、
  // そちらは既存のmyResErrが担う）。
  const [myWaitlist, setMyWaitlist] = useState([])
  const [wlCancelingId, setWlCancelingId] = useState(null)
  const [wlCancelConfirmId, setWlCancelConfirmId] = useState(null)
  const [wlCancelErr, setWlCancelErr] = useState('')
  const [lateReqId, setLateReqId] = useState(null)
  const [lateReqType, setLateReqType] = useState('change')
  const [lateReqMsg, setLateReqMsg] = useState('')
  const [lateReqSubmitting, setLateReqSubmitting] = useState(false)
  const [lateReqDoneIds, setLateReqDoneIds] = useState(new Set())
  const [lateReqErr, setLateReqErr] = useState('')

  // 下書き（sessionStorage）から入力内容を復元した直後だけtrueにし、お客様に「さっき入力した内容が
  // そのまま戻ってきた」ことを軽く伝えるための状態（Appleデザインチーム視点レビュー・ラウンド46での
  // 指摘：これまでは復元処理自体はあっても画面上・スクリーンリーダー上どちらにも一切合図が無く、
  // 名前・電話番号・選択済みの日時などが無言でいきなり埋まっているように見え、「あれ、もう入力した
  // っけ？」と戸惑わせる恐れがあった）。エラーではなく一時的な案内なのでrole="status"・politeとし、
  // 数秒後に自動で消す（フォーム操作の邪魔にならない程度の短い表示に留める）。
  const [bookingDraftRestored, setBookingDraftRestored] = useState(false)
  const [changeDraftRestored, setChangeDraftRestored] = useState(false)

  // 変更フォーム
  const [changingRes, setChangingRes] = useState(null)
  const [chgDate, setChgDate] = useState('')
  const [chgTime, setChgTime] = useState('')
  const [chgGuests, setChgGuests] = useState('')
  const [chgMsg, setChgMsg] = useState('')
  const [chgErr, setChgErr] = useState('')
  const [chgcfErr, setChgcfErr] = useState('')
  const [chgSubmitting, setChgSubmitting] = useState(false)
  // 下書き復元（restoreChangeDraftIfAny）専用。バックグラウンド中（最大6時間、BOOKING_DRAFT_MAX_AGE_MS）に
  // スタッフがadmin.jsから、または本人が別デバイス・別タブから、この予約自体を変更・キャンセル済みだと、
  // 画面上部の「変更対象の予約」カードは復元直後のchangingRes（メモリ上の古いスナップショット）を
  // そのまま表示し続け、キャンセル済みの予約に対して新しい日時を選び、確認画面まで丸ごと進めてしまう
  // （Google CEO視点レビューでの指摘：残席状況＝avail はfetchAvailabilityで必ず取り直しているのに、
  // 変更対象の予約そのものの現在の状態は一切問い合わせ直していなかった）。復元直後に一度だけ
  // getMyReservationsで裏取りし、対象が見つからない／既にキャンセル済みだった場合はここをtrueにして
  // 先へ進めないようにする（見つかった場合はchangingResを最新の内容へ更新するだけで、trueにはしない）。
  const [chgResGone, setChgResGone] = useState(false)

  const effectiveGuests = !guestCountEnabled ? fixedGuestCount : (selGuest === 'konsult' ? '' : selGuest)
  const t = useMemo(() => makeT(lang), [lang])
  // t()の辞書は固定の日本語キー（'ご来店日'等）に対する翻訳のため、業態によって変わるvisitNoun
  // （来店/来院/来館等）を含む文言だけはt()の辞書照合をバイパスし、日本語モードでは実行時に
  // 「来店」を置き換える（英語モードは既存の辞書訳をそのまま使う。多くは"Date"/"Time"のように
  // そもそも"visit"という語を含まないため、visitNounEnの出番は無い）。
  function visitText(jaTemplate) {
    return lang === 'en' ? t(jaTemplate) : jaTemplate.replace(/来店/g, visitNoun)
  }
  const showTimeCard = !!selDate
  const showGuestCard = guestCountEnabled && !!(selDate && selTime)

  // ===== 同伴者情報（人数分だけ、名前・アレルギー等を個別入力できるようにする） =====
  function companionCount() {
    const g = parseInt(effectiveGuests, 10)
    return Number.isFinite(g) && g >= 1 ? Math.min(g, 12) : 1
  }
  useEffect(() => {
    const n = companionCount()
    setCompanions(prev => {
      if (prev.length === n) return prev
      const next = prev.slice(0, n)
      while (next.length < n) next.push({ name: '', allergy: '' })
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGuests])
  function updateCompanion(i, field, value) {
    setCompanions(prev => prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c)))
  }
  function buildNotesPayload() {
    const parts = []
    if (companionCount() >= 2) {
      // 「1人目」「【同伴者情報】」がlang分岐なしで常に日本語固定になっていた。この関数の戻り値は
      // 確認画面（1939行目付近）でお客様本人にも表示されるため、英語モードの画面に日本語の見出しが
      // 混在してしまっていた（審判団バックログ一括レビューでの指摘）。同伴者名の入力欄プレースホルダー
      // （1737行目付近）には既にlang分岐があるのに、こちらだけ漏れていた。
      const rows = companions.slice(0, companionCount()).map((c, i) => {
        const label = c.name.trim() || (lang === 'en' ? `Guest ${i + 1}` : `${i + 1}人目`)
        return c.allergy.trim() ? `${label}：${c.allergy.trim()}` : null
      }).filter(Boolean)
      if (rows.length) parts.push((lang === 'en' ? 'Companion info' : '【同伴者情報】') + '\n' + rows.join('\n'))
    }
    if (notes.trim()) parts.push(notes.trim())
    return parts.join('\n\n')
  }

  // ===== 月別空席取得 =====
  async function fetchMonthAvail(year, month) {
    const cacheKey = `${year}-${month}`
    if (monthAvailCacheRef.current[cacheKey] !== undefined) {
      setMonthAvail(monthAvailCacheRef.current[cacheKey])
      setMonthAvailLoading(false)
      return
    }
    setMonthAvailLoading(true)
    let dates = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await api.getMonthAvailability(year, month + 1)
        dates = r.dates || {}
        break
      } catch {
        if (attempt < 2) await new Promise(res => setTimeout(res, 1500 * (attempt + 1)))
      }
    }
    if (dates !== null) {
      monthAvailCacheRef.current[cacheKey] = dates
      setMonthAvail(dates)
      ;[-3, -2, -1, 1, 2, 3].forEach(delta => {
        let pm = month + delta, py = year
        if (pm < 0) { pm = 11; py-- }
        if (pm > 11) { pm = 0; py++ }
        const key = `${py}-${pm}`
        if (monthAvailCacheRef.current[key] !== undefined) return
        api.getMonthAvailability(py, pm + 1).then(rr => {
          const preData = rr.dates || {}
          if (monthAvailCacheRef.current[key] === undefined && Object.keys(preData).length > 0)
            monthAvailCacheRef.current[key] = preData
        }).catch(() => {})
      })
    } else {
      setMonthAvail({})
    }
    setMonthAvailLoading(false)
  }

  // ===== コース × 時間帯 → 選択可能スロット / 所要時間 =====
  // dateOverrides > dailyHours > timeRangesの優先順位で、指定日・コースの提供時間帯に応じたスロットを算出
  function computeTimeSlotsForDate(dateStr, mealType, dailyHours, dateOverrides, timeRanges) {
    if (dateStr && (dailyHours || dateOverrides)) {
      const dow = parseDate(dateStr).getDay()
      const override = dateOverrides && dateOverrides[dateStr.replace(/-/g, '/')]
      const dayH = override || (dailyHours && dailyHours[String(dow)])
      if (dayH) {
        const dayRanges = []
        if ((mealType === 'lunch' || mealType === 'both') && dayH.lunchEnabled)
          dayRanges.push({ type:'lunch', start:dayH.lunchStart, end:dayH.lunchEnd })
        if ((mealType === 'dinner' || mealType === 'both') && dayH.dinnerEnabled)
          dayRanges.push({ type:'dinner', start:dayH.dinnerStart, end:dayH.dinnerEnd })
        const all = []
        dayRanges.forEach(tr => generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) }))
        // dailyHours/dateOverridesがその日の営業時間として設定されている場合は、それが唯一の正解。
        // 該当するmealTypeの枠が0件でも空配列を返し、より汎用的なtimeRanges・最終手段のTIME_SLOTS
        // （飲食店のディナー帯17-21時）へフォールバックしない。以前はここでフォールバックしていたため、
        // 例えばクリニック業態が「ランチ」欄で午前診療時間を設定していても、コースのmealTypeが既定の
        // 'dinner'のままだと、実際には診療していない17-21時が予約可能時間として提示されてしまっていた
        // （業種経営者陣視点レビューでの指摘）。
        return all.sort()
      }
    }
    const ranges = (timeRanges || []).filter(tr =>
      mealType === 'both' || tr.type === mealType || tr.type === 'both'
    )
    if (!ranges.length) return TIME_SLOTS
    const all = []
    ranges.forEach(tr => generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) }))
    return all.sort()
  }

  const visibleCourses = useMemo(() => settingsCourses.filter(c => !c.discontinued), [settingsCourses])
  const isSimpleMode = bookingMode === 'simple'
  const selStayMin = visibleCourses[selCourse]?.duration || STAY_MIN
  const courseTimeSlots = useMemo(() => {
    // コース無しモードでは特定コースの提供時間帯に縛られず、その日有効な時間帯（ランチ・ディナー等）を全て出す
    const mealType = isSimpleMode ? 'both' : (visibleCourses[selCourse]?.mealType || 'dinner')
    return computeTimeSlotsForDate(selDate, mealType, settingsDailyHours, settingsDateOverrides, settingsTimeRanges)
  }, [visibleCourses, selCourse, settingsTimeRanges, settingsDailyHours, settingsDateOverrides, selDate, isSimpleMode])

  // 変更対象の予約のコース名から提供時間帯（ランチ/ディナー/両方）を引き、新しい日付での選択可能スロットを算出
  const chgTimeSlots = useMemo(() => {
    const matched = settingsCourses.find(c => c.name === changingRes?.course)
    const mealType = matched?.mealType || 'dinner'
    return computeTimeSlotsForDate(chgDate, mealType, settingsDailyHours, settingsDateOverrides, settingsTimeRanges)
  }, [settingsCourses, changingRes, chgDate, settingsDailyHours, settingsDateOverrides, settingsTimeRanges])
  // 変更対象の予約のコースの所要時間（コースごとに滞在時間が異なる店舗向け。見つからなければ既定値にフォールバック）
  const chgStayMin = settingsCourses.find(c => c.name === changingRes?.course)?.duration || STAY_MIN
  const effectiveChgGuests = !guestCountEnabled ? fixedGuestCount : chgGuests

  // ===== 締め切り計算 =====
  function getDeadline(dateStr) {
    if (!dateStr) return null
    const d = parseDate(dateStr)
    const ymd = String(dateStr).replace(/-/g, '/')
    const isHol = !!holidays[ymd]
    const key = isHol ? 'holiday' : String(d.getDay())
    const rule = settingsCutoffRules[key] || { daysBefore:2, time:'22:00' }
    const [h, m] = rule.time.split(':').map(Number)
    const dl = new Date(d)
    dl.setDate(dl.getDate() - rule.daysBefore)
    dl.setHours(h, m, 0, 0)
    return dl
  }

  function deadlinePassed(dateStr) {
    const dl = getDeadline(dateStr)
    if (!dl) return true
    return new Date() > dl
  }

  function deadlineLabel(dateStr) {
    if (!dateStr) return ''
    const dl = getDeadline(dateStr)
    if (!dl) return ''
    const d = parseDate(dateStr)
    const ymd = String(dateStr).replace(/-/g, '/')
    const isHol = !!holidays[ymd]
    const dow = d.getDay()
    const key = isHol ? 'holiday' : String(dow)
    const rule = settingsCutoffRules[key] || { daysBefore:2, time:'22:00' }
    const mo = dl.getMonth() + 1
    const da = dl.getDate()
    // 日付選択のたびに表示される頻出テキストなのに未翻訳のまま残っていた（ランダム客層視点レビューでの指摘）
    if (lang === 'en') {
      // 数字だけの${mo}/${da}はM/D・D/Mどちらの読者にも解釈が割れ、日付が誤読されうる。
      // 他の英語日付表記（fmtDateLang）は月名スペルアウトなので揺れを無くす（Google CEO視点レビューでの指摘）
      const enDate = fmtMonthDayEn(mo, da)
      if (isHol) return `※ Holiday — accepted until ${enDate} (${rule.daysBefore} days before) ${rule.time}`
      if (dow === 0 || dow === 6) return `※ Weekend — accepted until ${enDate} (${rule.daysBefore} days before) ${rule.time}`
      return `※ Accepted until ${rule.daysBefore} days before your visit (${enDate}) ${rule.time}`
    }
    if (isHol) return `※ 祝日のため${mo}/${da}（${rule.daysBefore}日前）${rule.time}まで受付`
    if (dow === 0 || dow === 6) return `※ 土日のため${mo}/${da}（${rule.daysBefore}日前）${rule.time}まで受付`
    return `※ ${visitNoun}日の${rule.daysBefore}日前（${mo}/${da}）${rule.time}まで受付`
  }

  function isChangeCancelable(dateStr) {
    const dl = getDeadline(dateStr)
    if (!dl) return false
    return new Date() <= dl
  }

  // ===== 人数ボタンの状態 =====
  function guestDisabled(n) {
    if (availErr) return true
    if (!avail || availLoading) return false
    if (n === 1) return !avail.canBook1
    // 担当者単位の容量モデルでは「担当者が空いているか」だけが制約で、人数（何名で来店するか）は席数を減らさない
    if (capacityModel === 'perStaff') return !avail.canBook2to5
    if (n >= 2) return n > avail.remainingSeats
    return false
  }
  function kasshikiDisabled() {
    if (!avail || availLoading) return false
    return !avail.canKasshiki
  }
  function konsultDisabled() {
    if (!avail || availLoading) return false
    return !avail.canKasshikiConsult
  }
  // t()は日本語原文をキーにした辞書引きのため、staffLabelのように店舗ごとに自由入力される
  // 動的な文言を埋め込んだテンプレート文字列をt()に渡すと、既定値「担当者」以外の呼び方（例：
  // 「スタイリスト」「施術者」等）にカスタマイズしている店舗では辞書キーが一致せず、英語モードでも
  // 日本語のまま表示されてしまう（ランダム客層視点レビューでの指摘：他業態向けの汎用化を進めるほど
  // 表面化するi18nの穴）。goConfirm内の同種の分岐（917行目付近）と同じくlangで直接分岐する。
  function staffCheckingText() {
    return lang === 'en' ? `Checking ${staffLabel} availability...` : `${staffLabel}を確認中...`
  }
  function staffCheckFailText() {
    return lang === 'en'
      ? `Failed to check ${staffLabel} availability. Please try again with a better connection.`
      : `${staffLabel}の確認に失敗しました。電波の良い場所でもう一度お試しください。`
  }
  // キャンセル待ちの通知条件（strict）ラジオの文言「ちょうどこの時間・担当者が空いたときだけ通知する」が、
  // capacityModel!=='daily'の全業態（timeSlot・perStaff）で固定文字列のまま表示されていた（業種経営者陣視点
  // レビュー・第44回：car_rental/leisure_equipのperStaff+資産系countUnitウォークスルーでの指摘）。
  // (1) perStaffでもstaffLabelが「車両」「器材」等の資産名の業態（car_rental・leisure_equip）では
  // 「担当者」という人物を指す言葉が実際の対象（車両・器材）とズレる。(2) timeSlot業態（レンタサイクル等、
  // staffAssignmentEnabled:false）ではそもそも担当者という概念自体が存在せず（joinWaitlist内、916行目
  // 付近でstaffを送っていない）、「担当者」という言葉が実在しない選択肢を匂わせてしまう。perStaffの場合は
  // staffLabelを埋め込み、それ以外（timeSlot）では担当者に触れない文言にする（staffCheckingText等と
  // 同じくt()辞書を経由せずlangで直接分岐する）。
  function waitlistStrictLabel() {
    if (capacityModel === 'perStaff') {
      return lang === 'en' ? `Only notify me when exactly this time and ${staffLabel} open up` : `ちょうどこの時間・${staffLabel}が空いたときだけ通知する`
    }
    return lang === 'en' ? 'Only notify me when exactly this time opens up' : 'ちょうどこの時間が空いたときだけ通知する'
  }

  // ===== 空席取得 =====
  async function fetchAvailability(date, time, course, staff) {
    if (!date) return
    const reqId = ++availReqIdRef.current
    setAvailLoading(true)
    setAvail(null)
    setAvailErr('')
    try {
      const r = await api.getAvailability(date, time, course, staff)
      // 応答が戻った時点で、既にこれより新しいリクエストが発行済みなら（=このリクエストは古い）、
      // 結果を無視する（新しい選択の表示を古い応答で上書きしないため）。
      if (reqId !== availReqIdRef.current) return
      // 満席カードの種別（通常満席 vs 貸切満席）がこの応答で変わる場合、日付・時間・担当者・人数・
      // コース変更時のonChangeリセットが拾えない経路（例：残席確認失敗時の「再試行」ボタン）でも、
      // 直前まで別種のカードで登録済みだったwlDone/wlErrが残ってしまい、切り替わった先のカードで
      // まだ登録していないのに「✅登録しました」と誤表示され、実際の登録フォームも隠れてしまう
      // （ランダム客層視点レビュー・ラウンド39での指摘）。
      if (!!(avail && avail.hasKasshiki) !== !!r.hasKasshiki) {
        setWlDone(false); setWlErr('')
      }
      setAvail(r)
    } catch {
      if (reqId !== availReqIdRef.current) return
      setAvail(null)
      setAvailErr(capacityModel === 'perStaff'
        ? staffCheckFailText()
        : t('残席の確認に失敗しました。電波の良い場所でもう一度お試しください。'))
    }
    if (reqId === availReqIdRef.current) setAvailLoading(false)
  }

  // ===== 受付期限後の変更・キャンセルをLINEで依頼 =====
  async function submitLateRequest(res) {
    setLateReqSubmitting(true)
    setLateReqErr('')
    try {
      const r = await api.requestLateChangeOrCancel({
        reservationId: res.id, lineUserId: profile?.userId || '', idToken, phone: myResPhoneUsed, name: myResNameUsed,
        type: lateReqType, message: lateReqMsg.trim(),
      })
      if (r.success) {
        setLateReqDoneIds(prev => new Set(prev).add(res.id))
        setLateReqId(null)
        setLateReqMsg('')
      } else {
        setLateReqErr(r.error || t('送信に失敗しました'))
      }
    } catch {
      setLateReqErr(t('通信エラーが発生しました。お電話にてご連絡ください'))
    }
    setPrivacyConsent(false)
    setLateReqSubmitting(false)
  }

  // ===== キャンセル待ち登録 =====
  // targetDate/targetGuestsを渡すと変更フロー（chgDate/effectiveChgGuests）向けに使える。省略時は
  // 新規予約フロー（selDate/effectiveGuests）のまま動く（既存呼び出し元との後方互換のため既定値化）。
  // 呼び出し元は必ず () => joinWaitlist(...) の形でラップすること（下のundefinedチェックは「引数を
  // 渡さなかった」ことを前提にしており、onClick={joinWaitlist}のように直接関数を渡すと、Reactが
  // クリックのSyntheticEventを第一引数targetDateとして渡してしまい、常に真値になるため
  // date: targetDate || selDate が誤ってイベントオブジェクトの方を採用してしまう
  // ——ランダム客層視点レビューでの指摘：新規予約フローの2箇所が実際にこの書き方になっており、
  // キャンセル待ち登録のたびに送信される日付が壊れていた）。
  // targetTime：変更フロー向け（chgTime）。省略時（新規予約フロー）はselTimeを使う。
  // 以前はtargetDateが渡された（＝変更フロー由来の呼び出し全て）場合にtimeを常にundefinedで
  // 送信していたため、お客様が「ちょうどこの時間・担当者」（strict）を選んでも、実際に送信される
  // 時間が常に空になり選択が黙って無効化されていた（ランダム客層視点レビュー・ラウンド37での指摘）。
  // forceAnyTime：貸切（買い切り）満席カードからの呼び出し専用。このカードは丸ごと1日をブロックする
  // 予約のため「厳密にこの時間・担当者が空いたら」という粒度自体が意味を持たず、通知条件ラジオ自体を
  // 表示していない。にもかかわらず、直前まで別の（通常満席）カードで選んでいたwlNotifyCondition/選択中の
  // 時間・担当者がそのまま素通りしてしまう実バグがあった（ランダム客層視点レビュー・ラウンド38での指摘）。
  async function joinWaitlist(targetDate, targetGuests, targetTime, forceAnyTime) {
    if (!name.trim() || !phone.trim()) { setWlErr(t('お名前と電話番号を入力してください')); return }
    if (!isValidPhoneFormat(phone)) { setWlErr(t('電話番号の形式が正しくありません')); return }
    setWlSubmitting(true)
    setWlErr('')
    try {
      // 'daily'業態は元々「日付単位」の空き判定で正しい設計のため、通知条件は常に'anyTime'（同じ日なら
      // いつでも通知）で送る。時間帯・担当者制（timeSlot/perStaff）だけ、お客様が選んだ通知条件と
      // 現在選択中の時間・担当者を一緒に送る（業種経営者陣視点レビュー・ラウンド30での指摘、
      // ユーザー承認済み）。
      const notifyCondition = (capacityModel === 'daily' || forceAnyTime) ? 'anyTime' : wlNotifyCondition
      const r = await api.joinWaitlist({
        lineUserId: profile?.userId || '', idToken,
        name: name.trim(), phone: phone.trim(),
        // ||ではなく明示的なundefinedチェックにする。変更フローはchgGuestsが未選択（''）の状態でも
        // このカードを表示・送信できてしまうため、'||'だと''が偽値としてeffectiveGuests（新規予約
        // フロー側の、無関係な古いselGuestの値が残っている可能性がある変数）にフォールバックしてしまい、
        // 変更フローからの登録なのに別フローの人数が紛れ込む（ランダム客層視点レビューでの指摘）。
        date: targetDate !== undefined ? targetDate : selDate,
        guests: targetGuests !== undefined ? targetGuests : (effectiveGuests || ''),
        // forceAnyTime（貸切満席カード）は日単位ブロックのため、時間・担当者は最初から送らない
        // （上記コメント参照）。
        time: forceAnyTime ? undefined : (targetDate !== undefined ? targetTime : selTime),
        // 変更フロー画面には担当者選択UI自体が無いため（新規予約フローの指名ボタンに相当するものが
        // 存在しない）、targetDateが渡された場合はstaffを送らない。これは既存の挙動と同じで、今回の
        // 修正では「時間」だけを変更フローからも正しく送るようにする（担当者の扱いは別途検討候補）。
        staff: (forceAnyTime || targetDate !== undefined || !staffAssignmentEnabled) ? undefined : selStaff,
        notifyCondition, language: lang,
      })
      if (r.success) setWlDone(true)
      else setWlErr(r.error || t('キャンセル待ちの登録に失敗しました'))
    } catch {
      setWlErr(t('通信エラーが発生しました。もう一度お試しください。'))
    }
    // 同意チェックは「このフォームでの送信」に対するものなので、他のフォーム（予約確定・期限後依頼等）に
    // チェック済みの状態が persist して見えないよう、送信後はリセットする（Apple CEO/イーロン/PMO視点
    // レビューでの指摘：1つのチェックボックス状態を4フォームで共有しており、同意の使い回しに見えていた）。
    setPrivacyConsent(false)
    setWlSubmitting(false)
  }

  // ===== 祝日取得（初回のみ）=====
  async function ensureHolidays() {
    if (holidaysFetchedRef.current) return
    holidaysFetchedRef.current = true
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      const r = await fetch('https://holidays-jp.github.io/api/v1/date.json', { signal: controller.signal })
      clearTimeout(timer)
      const data = await r.json()
      setHolidays(data || {})
    } catch {
      setHolidays({})
      holidaysFetchedRef.current = false // 失敗時は次回また取得を試みる
    }
  }

  // ===== 日付変更ハンドラ =====
  async function onDateChange(d) {
    setSelDate(d)
    setSelTime('')
    setSelGuest('')
    setIsKasshiki(false)
    setIsKonsult(false)
    setShowKasshikiWarning(false)
    setAvail(null)
    setInputErr('')
    setWlDone(false)
    setWlErr('')
    setWlNotifyCondition('anyTime')
    if (d) {
      // 空席取得は祝日データに依存しないため、ensureHolidays()の完了を待たずに並行して開始する。
      // （以前は直列にawaitしていたため、初回のみ祝日取得が最大5秒かかる間、
      // セッション最初の日付タップだけ何も起きていないように見えていた）。
      fetchAvailability(d, undefined, visibleCourses[selCourse]?.name)
      ensureHolidays()
    }
  }

  // LINEログイン後／ゲストモード決定後の共通の画面遷移（URLパラメータでマイ予約に直接遷移する分岐を含む）
  const proceedAfterAuth = useCallback((userId, isGuest, authIdToken) => {
    const goMyRes = new URLSearchParams(window.location.search).get('screen') === 'myres'
    // ゲスト向け確認メールの「マイ予約」深リンク（?screen=myres&guest=1）を踏んだ場合、セッションごとに
    // 変わる仮のゲストIDでは本人の予約と一切紐付かないため、以前はapi.getMyReservations(仮ID)が
    // 必ず空振りし、まさに助けるべきLINE未使用客が「予約がありません」という偽の表示に行き着き、
    // 電話番号入力フォームへの導線も無い詰み状態になっていた（ランダム客層視点レビュー・ラウンド27での
    // 指摘）。openMyRes()の通常経路と同じく、電話番号＋名前の検索フォームへ誘導する。
    if (goMyRes && isGuest) {
      setScreen('myres')
      setMyResNeedsPhone(true)
      return
    }
    if (goMyRes && userId) {
      setMyRes([])
      setMyResLoading(true)
      setCancelId(null)
      setScreen('myres')
      api.getMyReservations(userId, undefined, undefined, authIdToken).then(r => {
        setMyRes(r.success ? r.list || [] : [])
      }).catch(() => {
        setMyRes([])
      }).finally(() => setMyResLoading(false))
    } else if (restoreChangeDraftIfAny(userId, isGuest, authIdToken)) {
      // 変更フローの下書きが残っていれば優先して復元する（新規予約の下書きと変更の下書きが
      // 同時に残っているのは通常あり得ないが、万一両方残っていても、より最近まで操作していた
      // 方＝変更フローを優先する方が実害が小さい。新規予約側の古い下書きはそのまま残しておき、
      // 次回起動時にまだ有効期限内なら改めて判断される）。
      setScreen('change')
    } else {
      restoreBookingDraftIfAny()
      setScreen('input')
    }
  }, [])

  // LINEを使わずに予約する（PC等の外部ブラウザでLINEログインを選ばなかった場合の手動ゲスト移行）
  const proceedAsGuest = useCallback(() => {
    const guestId = 'guest_' + Date.now()
    setProfile({ userId: guestId, displayName: '' })
    setIsGuestMode(true)
    proceedAfterAuth(guestId, true)
  }, [proceedAfterAuth])

  // ===== LIFF初期化 =====
  const initLiff = useCallback(async () => {
    let userId = null
    let isGuestFallback = false
    // stateのidTokenはsetIdToken()直後の同期的な呼び出し（下記proceedAfterAuth）にはまだ反映されない
    // （Reactのstate更新は非同期のため）。関数スコープのローカル変数として保持し、そちらを渡す。
    let currentIdToken = ''
    try {
      await Promise.race([
        window.liff.init({ liffId: LIFF_ID }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ])
      if (window.liff.isLoggedIn()) {
        const p = await window.liff.getProfile()
        setProfile(p)
        userId = p.userId
        // liff.getIDToken()はLINE側で署名済みのJWTを返す。取得に失敗しても（スコープ未許可等）
        // 予約フロー自体は継続できるようにし、Code.gs側はidToken未送信時は後方互換の従来方式に
        // フォールバックする（LINE_CHANNEL_ID未設定の店舗も含め、既存動作を壊さない）。
        try { currentIdToken = window.liff.getIDToken() || '' } catch (idErr) { console.warn('LIFF getIDToken:', idErr.message) }
        setIdToken(currentIdToken)
        // リピーター情報はバックグラウンドで取得（画面遷移をブロックしない）
        api.getCustomerProfile(p.userId, currentIdToken).then((cp) => {
          if (cp.found) {
            // 取得が遅れて届いた場合、既に入力済みの内容を上書きしないようfunctional updateで現在値を確認
            if (cp.name) setName((prev) => prev ? prev : String(cp.name))
            if (cp.phone) setPhone((prev) => prev ? prev : String(cp.phone))
            if (cp.lastRequestedStaff) setPreferredStaff(String(cp.lastRequestedStaff))
          }
        }).catch(() => {})
      } else if (window.liff.isInClient()) {
        // LINEアプリ内ブラウザ：ログインは一瞬で完了するため、そのまま自動ログインへ進めてよい
        window.liff.login({ redirectUri: location.href })
        return
      } else {
        // PC・LINE外のブラウザ：ここで自動的にLINEログイン画面へ飛ばすと、LINEアカウントを
        // 使いたくない／持っていないお客様が先に進めなくなる。選択肢を提示する画面を出す
        setScreen('linechoice')
        return
      }
    } catch (e) {
      console.warn('LIFF:', e.message)
      const guestId = 'guest_' + Date.now()
      setProfile({ userId: guestId, displayName: '' })
      setIsGuestMode(true)
      userId = guestId
      isGuestFallback = true
    }
    proceedAfterAuth(userId, isGuestFallback, currentIdToken)
  }, [proceedAfterAuth])

  // initLiff内のPromise.raceはliff.init()自体にしか3秒タイムアウトを掛けていない。その前段の
  // <Script>読み込みが止まったまま（回線が不安定でonLoad/onErrorのどちらも発火しない場合や、
  // 通信を無応答のまま止めるプロキシ・captive portal等）だったり、liff.getProfile()が応答しない
  // 場合は上記3秒タイムアウトの外側になるため、従来はローディング画面から永久に抜けられなかった
  // （ランダム客層視点レビュー・ラウンド42での指摘）。initLiffの内部構造は変えず、LIFFの一連の
  // 流れ全体（スクリプト読み込み～liff.init～getProfile）に対する外側の安全網として、一定時間
  // （既存の3秒・6秒より十分長い9秒）経ってもまだローディング画面のままなら、既存のゲスト移行
  // 導線（proceedAsGuest）へ強制的に進める。画面が既に切り替わっていれば（＝initLiffが先に完了
  // していれば）このタイマーはクリーンアップされ発火しない。
  useEffect(() => {
    if (screen !== 'loading') return
    const timer = setTimeout(() => {
      console.warn('LIFF: script load / init flow did not complete within 9s, falling back to guest mode')
      proceedAsGuest()
    }, 9000)
    return () => clearTimeout(timer)
  }, [screen, proceedAsGuest])

  // 店名・コース一覧・営業時間等はオーナーが設定変更した時だけ変わる、頻繁には変わらないデータのため、
  // 再訪問時にlocalStorageのキャッシュを即座に反映してから、裏側で最新版を取りに行く
  // （stale-while-revalidate。初回表示が速くなり、万一通信が遅い時も「何も出ない」状態を避けられる）。
  const SETTINGS_CACHE_KEY = 'kaiya_settings_cache_v1'
  function applySettingsResponse(r) {
    if (!r || !r.success) return
    if (r.courses && r.courses.length > 0) {
      setSettingsCourses(r.courses)
      // このapplySettingsResponseは1回のページ表示で最大2回呼ばれる（①localStorageキャッシュから
      // 即座に・②裏側のapi.getSettings()が届いた時）。以前は②の時も無条件にselCourseを0へ戻して
      // いたため、①の表示を見てお客様が自分でコースを選び直した直後（あるいは下書き復元で選択済みの
      // コースが復元された直後）に②が遅れて届くと、選んだコースが無言で先頭へ巻き戻り、そのまま
      // 送信（createReservation、1511行目付近）されるコースがすり替わってしまっていた（Google CEO
      // 視点レビュー・ラウンド46での指摘：GAS側のコールドスタートで②が数秒〜十数秒遅れることは
      // gas.js側の28秒タイムアウト設定からも珍しくないと分かる）。現在選ばれているコースが新しい
      // 一覧（廃止済みを除く）の範囲内でまだ有効なら触らず、範囲外になった場合（件数が減った等）
      // だけ安全側の0へ寄せる。
      setSelCourse(prev => {
        const visibleCount = r.courses.filter(c => !c.discontinued).length
        return (prev >= 0 && prev < visibleCount) ? prev : 0
      })
    }
    if (r.timeRanges && r.timeRanges.length > 0) setSettingsTimeRanges(r.timeRanges)
    if (r.dailyHours) setSettingsDailyHours(r.dailyHours)
    if (r.dateOverrides) setSettingsDateOverrides(r.dateOverrides)
    if (r.cutoffRules) setSettingsCutoffRules(r.cutoffRules)
    if (r.bookingNotes) setBookingNotes(r.bookingNotes)
    if (r.featureFlags) setFeatureFlags(r.featureFlags)
    if (r.restaurantName) setBizName(r.restaurantName)
    if (r.restaurantTagline) setBizTagline(r.restaurantTagline)
    if (r.restaurantAddress) setBizAddress(r.restaurantAddress)
    if (r.businessCategory) setBusinessCategory(r.businessCategory)
    if (r.storeImageUrl) setStoreImageUrl(r.storeImageUrl)
    if (r.contactPhone) setBizPhone(r.contactPhone)
    // 「この質問自体が不要」な店舗（クリニック等）が選択肢を空にして保存すると、以前は空配列がfalsy
    // 扱いされてこの代入自体がスキップされ、useStateの初期値（貝屋和光＝飲食店向けの既定選択肢）が
    // 残り続けてしまっていた。店舗が意図的に空にした設定が、業態の合わない飲食店の選択肢へすり替わって
    // 表示される実害があった（Appleデザインチーム視点レビュー・ラウンド30での指摘）。undefined
    // （サーバーが未対応の古いキャッシュ等）の場合だけ既定値を維持し、空配列は空配列としてそのまま使う。
    if (r.q1Options !== undefined) setQ1Options(r.q1Options)
    if (r.q3Options !== undefined) setQ3Options(r.q3Options)
    if (r.q1Question) setQ1Question(r.q1Question)
    if (r.q3Question) setQ3Question(r.q3Question)
    if (r.bookingMode) setBookingMode(r.bookingMode)
    if (r.itemLabel) setItemLabel(r.itemLabel)
    if (r.itemIcon) setItemIcon(r.itemIcon)
    if (r.adBannerEnabled) setAdBanner({ enabled: true, imageUrl: r.adBannerImageUrl || '', text: r.adBannerText || '', linkUrl: r.adBannerLinkUrl || '', placements: (r.adBannerPlacements && r.adBannerPlacements.length) ? r.adBannerPlacements : ['done'] })
    if (r.capacityModel) setCapacityModel(r.capacityModel)
    if (r.staffLabel) setStaffLabel(r.staffLabel)
    if (r.countUnit) setCountUnit(r.countUnit)
    if (r.visitNoun) setVisitNoun(r.visitNoun)
    if (r.visitNounEn) setVisitNounEn(r.visitNounEn)
    if (r.guestCountEnabled !== undefined) setGuestCountEnabled(!!r.guestCountEnabled)
    if (r.fixedGuestCount) setFixedGuestCount(String(r.fixedGuestCount))
    if (r.companionInfoEnabled !== undefined) setCompanionInfoEnabled(!!r.companionInfoEnabled)
    if (r.emailCollectionEnabled !== undefined) setEmailCollectionEnabled(!!r.emailCollectionEnabled)
    if (r.enabledLanguages && r.enabledLanguages.length > 0) {
      setEnabledLanguages(r.enabledLanguages)
      // ブラウザの言語設定が対応言語に含まれていれば、初期表示をその言語にする（無ければ日本語のまま）
      const browserLang = (navigator.language || 'ja').slice(0, 2)
      if (r.enabledLanguages.includes(browserLang)) setLang(browserLang)
    }
    setStaffAssignmentEnabled(!!r.staffAssignmentEnabled)
    if (r.staffRoster) setStaffRoster(r.staffRoster)
  }

  useEffect(() => {
    const now = new Date()
    setDateMin(computeDateMin(now, {}))
    const mx = new Date(now)
    mx.setFullYear(mx.getFullYear() + 3)
    setDateMax(toYMD(mx))
    // キャッシュがあれば即座に反映（表示が一瞬でも速くなる。多少古い可能性はあるがすぐ上書きされる）
    try {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY)
      if (cached) applySettingsResponse(JSON.parse(cached))
    } catch {}
    // コース・時間帯設定を取得（裏側で必ず最新版に更新する）
    api.getSettings().then(r => {
      applySettingsResponse(r)
      if (r && r.success) {
        try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(r)) } catch {}
      }
    }).catch(() => {})
  }, [])

  // pendingCourseName（下書き復元専用、419行目付近のコメント参照）を、コース一覧（visibleCourses）が
  // 確定するたび名前で解決し直す。LIFFログイン・下書き復元とapi.getSettings()のどちらが先に終わるかは
  // 実行時のネットワーク状況次第で一定しないため、片方に依存せず「visibleCoursesが変わるたびに再試行」
  // という形にしてどちらの順序でも正しく解決できるようにする。一覧はあるのに名前が見つからない場合
  // （店舗側でそのコース名自体を変更・削除した場合）は、無限に待ち続けず既定（selCourseの初期値のまま）
  // へ諦めて進む。
  useEffect(() => {
    if (!pendingCourseName || visibleCourses.length === 0) return
    const idx = visibleCourses.findIndex(c => c.name === pendingCourseName)
    if (idx >= 0) setSelCourse(idx)
    setPendingCourseName('')
  }, [pendingCourseName, visibleCourses])

  // 祝日データが読み込まれたら dateMin を再計算
  useEffect(() => {
    if (Object.keys(holidays).length > 0) {
      setDateMin(computeDateMin(new Date(), holidays))
    }
  }, [holidays])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screen])

  useEffect(() => {
    fetchMonthAvail(calYear, calMonth)
  }, [calYear, calMonth])

  useEffect(() => {
    setSelTime('')
  }, [selCourse])

  // 入力画面にいる間だけ、入力途中の内容をsessionStorageへ保存する（上記BOOKING_DRAFT_KEYのコメント参照）。
  // 「確認画面へ」を押す前の、まだ何も送信していない状態を保存対象にする。
  useEffect(() => {
    if (screen !== 'input') return
    try {
      sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        // selCourseは配列の位置に過ぎず、復元時には並び替え・廃止等で別のコースを指しうる
        // （419行目付近のpendingCourseNameのコメント参照）ため、復元は名前ベースで行う。
        // selCourse自体も後方互換・保険として残しておくが、restoreBookingDraftIfAnyは
        // selCourseNameが取れる限りそちらを優先する。
        selDate, selTime, selGuest, selStaff, selCourse, selCourseName: visibleCourses[selCourse]?.name || '',
        name, phone, email, q1, q1Other, q3, q3Other, notes, companions,
      }))
    } catch {}
  }, [screen, selDate, selTime, selGuest, selStaff, selCourse, visibleCourses, name, phone, email, q1, q1Other, q3, q3Other, notes, companions])

  // 送信完了・キャンセル済み等、この下書きがもう不要になった時に消す（次回訪問時に古い内容が
  // 誤って復元されないようにする）。
  function clearBookingDraft() {
    try { sessionStorage.removeItem(BOOKING_DRAFT_KEY) } catch {}
  }
  // proceedAfterAuth（LINEログイン後／ゲストモード決定後、入力画面に入る直前）から一度だけ呼ぶ。
  // 復元後もavail（残席状況）はまだ取得していないため、選択済みの日付があれば裏側で取り直す
  // （選択自体は既にUIに反映されるので、画面がいきなり空になるようなことはない）。
  function restoreBookingDraftIfAny() {
    try {
      const raw = sessionStorage.getItem(BOOKING_DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      if (!d || !d.savedAt || Date.now() - d.savedAt > BOOKING_DRAFT_MAX_AGE_MS) { clearBookingDraft(); return }
      if (d.selDate) setSelDate(d.selDate)
      if (d.selTime) setSelTime(d.selTime)
      if (d.selGuest) setSelGuest(d.selGuest)
      if (d.selStaff) setSelStaff(d.selStaff)
      // 名前ベースの復元を優先する（1233行目付近のpendingCourseNameのコメント参照）。名前が
      // 保存されていない古い下書き（このフィールドを追加する前に保存された分）に対しては、
      // 従来通り位置ベースで復元する後方互換フォールバックのみ残す。
      if (d.selCourseName) setPendingCourseName(d.selCourseName)
      else if (typeof d.selCourse === 'number') setSelCourse(d.selCourse)
      if (d.name) setName(d.name)
      if (d.phone) setPhone(d.phone)
      if (d.email) setEmail(d.email)
      if (d.q1) setQ1(d.q1)
      if (d.q1Other) setQ1Other(d.q1Other)
      if (d.q3) setQ3(d.q3)
      if (d.q3Other) setQ3Other(d.q3Other)
      if (d.notes) setNotes(d.notes)
      if (Array.isArray(d.companions) && d.companions.length) setCompanions(d.companions)
      if (d.selDate) { ensureHolidays(); fetchAvailability(d.selDate, d.selTime || undefined) }
      // 実際に何かしら復元できた場合のみ案内を出す（空の下書きを復元扱いにしない）。数秒で自動的に消す。
      setBookingDraftRestored(true)
      setTimeout(() => setBookingDraftRestored(false), 8000)
    } catch {}
  }

  // 上と全く同じ理由（WebView破棄によるリロードでの入力消失）が、変更フロー（screen==='change'、
  // 既存予約の日程・時間・人数を選び直す画面）にも同様に当てはまるのに、新規予約フローの下書き
  // 保存だけが対応しており変更フローには保存の仕組み自体が無かった（ランダム客層視点レビュー・
  // ラウンド45での指摘：新規予約フローで直した教訓が別フローに横展開されていなかった過去のパターン
  // の再発）。changingRes（変更対象の予約そのもの、myResの中から選んだ1件）は既にメモリ上に
  // 保持済みの情報のため、再度サーバーへ問い合わせ直す必要はなく、丸ごと一緒に保存・復元すれば足りる。
  // ゲスト利用時に変更・キャンセルAPIへ渡す電話番号・お名前（myResPhoneUsed/myResNameUsed）も、
  // ゲストIDはセッションごとに使い捨てで本人確認に使えないため、これらを一緒に保存しないと復元後の
  // 変更確定リクエストが本人特定できず失敗してしまう。
  useEffect(() => {
    if (screen !== 'change' || !changingRes) return
    try {
      sessionStorage.setItem(CHANGE_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        changingRes, chgDate, chgTime, chgGuests, chgMsg,
        myResPhoneUsed, myResNameUsed,
      }))
    } catch {}
  }, [screen, changingRes, chgDate, chgTime, chgGuests, chgMsg, myResPhoneUsed, myResNameUsed])

  function clearChangeDraft() {
    try { sessionStorage.removeItem(CHANGE_DRAFT_KEY) } catch {}
  }
  // restoreBookingDraftIfAnyと同じくproceedAfterAuthから一度だけ呼ぶ。復元できた場合はtrueを返し、
  // 呼び出し元がその後の画面遷移（'input'ではなく'change'にする）を判断できるようにする。
  // userId/isGuest/authIdToken はproceedAfterAuth自身の引数をそのまま受け取る（setProfile直後は
  // profile state自体がまだ反映されていないため、stateを読まずに引数で受け渡す。proceedAsGuest／
  // initLiff側で既に同じ理由でこの受け渡し方をしている＝それに倣う）。
  function restoreChangeDraftIfAny(userId, isGuest, authIdToken) {
    try {
      const raw = sessionStorage.getItem(CHANGE_DRAFT_KEY)
      if (!raw) return false
      const d = JSON.parse(raw)
      if (!d || !d.savedAt || Date.now() - d.savedAt > BOOKING_DRAFT_MAX_AGE_MS || !d.changingRes || !d.changingRes.id) { clearChangeDraft(); return false }
      setChangingRes(d.changingRes)
      if (d.chgDate) setChgDate(d.chgDate)
      if (d.chgTime) setChgTime(d.chgTime)
      if (d.chgGuests) setChgGuests(d.chgGuests)
      if (d.chgMsg) setChgMsg(d.chgMsg)
      if (d.myResPhoneUsed) setMyResPhoneUsed(d.myResPhoneUsed)
      if (d.myResNameUsed) setMyResNameUsed(d.myResNameUsed)
      const now = new Date()
      setCalYear(now.getFullYear())
      setCalMonth(now.getMonth())
      // 新規予約フローの復元（1233行目付近）と同じ理由で、残席状況は必ず取り直す（バックグラウンド中に
      // 満席になっている可能性があるため、古い判定のまま変更を確定させない）。
      if (d.chgDate) fetchAvailability(d.chgDate, d.chgTime || undefined, d.changingRes.course)
      // 新規予約フローの復元案内（restoreBookingDraftIfAny）と同じ理由・同じ挙動（数秒で自動的に消す）。
      setChangeDraftRestored(true)
      setTimeout(() => setChangeDraftRestored(false), 8000)
      // ここまではavail（残席）しか取り直しておらず、changingRes（変更対象の予約そのもの）は
      // バックグラウンド中に古くなった可能性があるメモリ上のスナップショットのまま画面に出てしまう
      // （Google CEO視点レビュー・ラウンド46での指摘）。本人特定に使えるパラメータ（LINEログイン済みなら
      // userId・未ログインならmyResPhoneUsed/myResNameUsed）でgetMyReservationsを呼び直し、
      // 同じidの予約が今も存在し・キャンセル済みでないかを裏取りする。取得自体に失敗した場合（回線不良等）は、
      // 誤ってブロックしないよう何もしない（最終的な整合性はsubmitChange時のバックエンド側チェックに委ねる）。
      const resId = d.changingRes.id
      const phoneUsed = d.myResPhoneUsed || ''
      const nameUsed = d.myResNameUsed || ''
      const lookup = (!isGuest && userId)
        ? api.getMyReservations(userId, undefined, undefined, authIdToken)
        : (phoneUsed && nameUsed) ? api.getMyReservations('', phoneUsed, nameUsed) : null
      if (lookup) {
        lookup.then(r => {
          if (!r || !r.success || !Array.isArray(r.list)) return
          const fresh = r.list.find(x => x.id === resId)
          if (!fresh || fresh.status === 'キャンセル') {
            setChgResGone(true)
            setChgErr(t('この予約は既に変更またはキャンセルされているため、続行できません。お手数ですが「マイ予約」から最新の状況をご確認ください。'))
            return
          }
          // 予約自体はまだ有効だが、待機中にスタッフ側等で日時・人数・コース等が変わっていた場合、
          // 画面上部の「変更対象の予約」カードとchgGuestDisabled（自分の分の除外判定）の両方が
          // このchangingResを参照しているため、最新の内容に差し替えて古い表示のまま進めさせない。
          setChangingRes(fresh)
        }).catch(() => {})
      }
      return true
    } catch {}
    return false
  }

  // restoreChangeDraftIfAny内のgetMyReservations裏取りは非同期のため、その応答が返ってくる頃には
  // お客様が既に日時・人数を選んでchgconfirm画面まで進んでしまっている場合がある。その画面のボタンは
  // disabled={chgResGone}で押せなくなるだけでは「なぜ押せないか」が伝わらないため、chgconfirm側にも
  // 同じ案内をchgcfErr経由で出す（'change'画面側はchgErrで既に案内済み）。
  useEffect(() => {
    if (chgResGone && screen === 'chgconfirm') {
      setChgcfErr(t('この予約は既に変更またはキャンセルされているため、続行できません。お手数ですが「マイ予約」から最新の状況をご確認ください。'))
    }
  }, [chgResGone, screen])

  // ===== バリデーション =====
  // エラー発生時、原因の項目までスクロールして分かりやすくする
  function scrollToCard(id) {
    if (typeof document === 'undefined') return
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 見た目はこのscrollIntoViewで該当カードまでスクロールするが、キーボード操作・スクリーンリーダー
    // 利用者はそれだけでは実際のフォーカス位置が変わらず、直前にいた場所（例：はるか下の
    // 「確認画面へ」ボタン）に留まったままになる。エラー本文自体はrole="alert"で読み上げられるが、
    // 読み上げ後にTabしても該当項目には飛べず、直す場所まで手動で戻って探す必要があった
    // （ランダム客層＝スクリーンリーダー利用者視点レビュー・ラウンド43での指摘）。
    // カード自体に一時的にフォーカスを移し、以降のTab操作をこのカードの内側から開始できるようにする
    // （tabindexは通常のTab順に混ざらないよう-1のまま。持たせていないカードだけ動的に付与する）。
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }
  function errAt(id, msg) {
    setInputErr(msg)
    scrollToCard(id)
  }

  function goConfirm() {
    if (!selDate) return errAt('card-date', visitText('ご来店日を選択してください'))
    // 変更フロー（2117行目付近）には元々あった「選択日が受付期限を過ぎていないか」の最終チェックが、
    // 新規予約フローのここには無かった（ランダム客層視点レビューでの指摘：過去ラウンドの教訓と逆で、
    // 変更フローには実装済みなのに主フローに実装漏れがあったパターン）。dateMinは初回読み込み時に
    // 一度だけ計算する近似値のため、①カレンダー表示中に締切時刻をまたいでそのまま送信された場合、
    // ②店舗が締切ルール（settingsCutoffRules）を既定値と異なる設定に変更した場合、のいずれも
    // カレンダー上は選択可能に見えたまま実際の締切を過ぎて送信できてしまっていた。
    if (deadlinePassed(selDate)) return errAt('card-date', t('選択された日付は予約受付期限を過ぎています'))
    if (!selTime) return errAt('card-time', visitText('来店時間を選択してください'))
    if (guestCountEnabled && !selGuest && !isKasshiki) return errAt('card-guest', t('人数を選択してください'))
    if (!String(name).trim()) return errAt('card-contact', t('お名前を入力してください'))
    if (!String(phone).trim()) return errAt('card-contact', t('電話番号を入力してください'))
    if (!isValidPhoneFormat(phone)) return errAt('card-contact', t('電話番号の形式が正しくありません'))
    if (emailCollectionEnabled && isGuestMode && !String(email).trim()) return errAt('card-contact', t('メールアドレスを入力してください'))
    if (String(email).trim() && !isValidEmailFormat(email)) return errAt('card-contact', t('メールアドレスの形式が正しくありません'))
    if (!isKasshiki && selGuest) {
      // avail（残席状況）がまだ読み込み中（avail===null）の間は、下の容量チェック自体が
      // `if (avail && ...)` の条件により丸ごとスキップされ、何のエラーも出さずに確認画面へ
      // 進めてしまっていた。普段は日付・時間を選んでから名前・電話番号等を入力する間に
      // fetchAvailabilityが完了するため表面化しにくいが、下書き復元（restoreBookingDraftIfAny、
      // 1213行目付近）直後は全項目が既に入力済みの状態で「確認画面へ」ボタンがそのまま押せてしまい、
      // 復元直後に発行し直した残席確認（まだ回線の悪い端末では特に時間がかかる）が終わる前に
      // お客様がタップすると、既に満席になっている可能性のある枠のまま素通りしてしまう
      // （ランダム客層視点レビュー・ラウンド45での指摘）。読み込み中は明示的なエラーで止める。
      if (availLoading) return errAt('card-guest', t('空き状況を確認中です。少し待ってからもう一度お試しください'))
      if (avail) {
        const n = parseInt(selGuest) || 0
        if (capacityModel === 'perStaff') {
          if (n >= 2 && !avail.canBook2to5) return errAt('card-guest', lang === 'en' ? `No ${staffLabel} available for this time slot` : `この時間帯はご案内できる${staffLabel}が見つかりません`)
        } else if (n >= 2 && n > avail.remainingSeats) {
          return errAt('card-guest', lang === 'en' ? `Only ${avail.remainingSeats} ${countUnit} remaining, so we can't accept a party of ${n}` : `残り${avail.remainingSeats}${countUnit}のため、${guestsWithUnit(n)}のご予約はお受けできません`)
        }
        if (n === 1 && !avail.canBook1)
          return errAt('card-guest', guestUnit === '名' ? t('1名様のご予約はこの日はお受けできません') : (lang === 'en' ? `A single ${guestUnit} reservation is not available for this date` : `1${guestUnit}のご予約はこの日はお受けできません`))
      } else if (availErr) {
        // 上のavailLoadingガードは「読み込み中」だけを塞ぎ、再取得が失敗した場合（avail===null かつ
        // availErr有り）は素通りしてしまっていた（ランダム客層視点レビュー・ラウンド46での指摘）。
        // 読み込み中でスタックし続けることはない（fetchAvailabilityのcatchが必ずavailLoadingを
        // falseに戻す）が、その後の容量チェックが丸ごと`if (avail)`の条件でスキップされるため、
        // 満席かどうか一度も確認できていない枠のまま確認画面へ進めてしまう。特に下書き復元
        // （restoreBookingDraftIfAny）直後は選択済みの人数がそのまま残っているため見た目上は
        // 何の異常もなく通過してしまい、最も気づきにくい抜け穴になっていた。
        return errAt('card-guest', availErr)
      }
    }
    setInputErr('')
    // privacyConsentは入力画面上の他の同意チェックボックス（満席日のキャンセル待ちカード・貸切満席
    // カード等）と単一のstateを共有しているため、そちらでチェックを入れたまま（実際には送信せずに）
    // 別の日時へ変更してここに来ると、確認画面のチェックボックスが最初からチェック済みの状態で
    // 表示されてしまっていた。機微な自由記述を含みうる項目への「事前の明示的同意」（APPI要配慮
    // 個人情報）が実質的に無意味化するため、確認画面へ進むたびに必ずリセットする
    // （Apple CEO視点レビュー・ラウンド30での指摘）。
    setPrivacyConsent(false)
    if (bookingNotes) {
      setShowNotesPopup(true)
    } else {
      setScreen('confirm')
    }
  }

  // 人数の単位（名/台/件等）が店舗設定で変更できるのに、ボタンラベル（1563行目付近）以外の
  // 確認画面・完了画面・エラー文言は「名様」がハードコードされたままだった（累積指摘の総棚卸しでの
  // 指摘）。ボタンラベルと同じcountUnit方式に統一する。「名」の場合のみ既存のt('名様')（敬称付き）を
  // 使い、店舗独自の単位（台・件等）には敬称を付けない（「2台様」等は不自然なため）。
  //
  // ↑の統一を全業態にそのまま広げた結果、新しい不整合が生まれていた（業種経営者陣視点レビュー・
  // 第43回での指摘）：capacityModel==='perStaff'（車両・器材等を1台＝1予約枠として管理する業態）
  // では、この「人数」欄はその1台に乗る／使う人の頭数（車のレンタルの乗車人数、ボートの乗員数等）
  // を表し、countUnit（台・件等、資産側の数え方）とは別の概念——レンタカー1台に3人乗っても消費する
  // 車両は1台のまま（avail計算もcanBook2to5等でstaffLabel側だけを見ており、countUnit側の残数計算には
  // guestsを使っていない。1195〜1199行目付近参照）。そのためcountUnitが「台」のcar_rental・
  // leisure_equipプリセットでは、乗車人数の選択ボタンが「3台」のように表示され、お客様には「3人分の
  // 予約＝車3台？」という誤解を招く。一方、capacityModel!=='perStaff'（daily/timeSlot）の業態
  // （飲食店のcountUnit=名、レンタサイクルのcountUnit=台等）は人数がそのまま容量消費数と一致するため
  // 従来通りcountUnitでよい。「人（頭数）」は業態を問わず常に「名」で数えるべき概念のため、
  // perStaffの場合だけ「名」に固定した専用の単位（guestUnit）を用意し、人数系の表示はここを使う。
  const guestUnit = capacityModel === 'perStaff' ? '名' : countUnit
  function guestsWithUnit(g) {
    if (guestUnit === '名') return `${g}${t('名様')}`
    return lang === 'en' ? `${g} ${guestUnit}` : `${g}${guestUnit}`
  }
  // 「13名以上・大人数のご相談」（konsultボタン・確認/完了画面等）も guestsWithUnit と同じ理由で
  // 「名」がハードコードされたまま取り残されていた（貸切機能fset.kasshiki.enabledはperStaff以外の
  // 全業態でON可能なため、countUnit='台'のレンタサイクル等が貸切機能をONにすると「13名以上」という
  // 誤った単位が表示される。Apple CEO視点レビュー・第44回、round43の「ボタンラベル以外の取り残し」
  // 総点検での指摘）。ボタンの選択肢が1〜12までな（1809行目付近）ため「13」自体は業態を問わず
  // 固定でよいが、単位はguestUnitに従わせる。
  function konsultGuestLabel() {
    if (guestUnit === '名') return t('13名以上・人数未定（ご相談）')
    return lang === 'en' ? `13+ ${guestUnit} / undecided (consultation)` : `13${guestUnit}以上・人数未定（ご相談）`
  }
  function konsultButtonLabel(disabled) {
    if (guestUnit === '名') return disabled ? t('💬 13名以上・大人数のご相談 — 本日は受付不可') : t('💬 13名以上・大人数のご相談')
    if (lang === 'en') return disabled ? `💬 Consult for 13+ ${guestUnit} — unavailable today` : `💬 Consult for 13+ ${guestUnit}`
    return disabled ? `💬 13${guestUnit}以上・大人数のご相談 — 本日は受付不可` : `💬 13${guestUnit}以上・大人数のご相談`
  }
  // 予約済みレコードの人数表示（'未定'＝人数未確定の予約は言語に応じて翻訳表示する。
  // 生の '未定' 文字列に単位を連結すると英語表示時に "未定 guests" のような
  // 言語混在表示になってしまうため、未確定値は必ず t('人数未定') 経由で表示する）
  function guestsDisplay(g) {
    return (g && g !== '未定') ? guestsWithUnit(g) : t('人数未定')
  }

  // ===== 予約送信 =====
  async function submitReservation() {
    setSubmitting(true)
    setCfErr('')
    setPrivacyConsent(false)
    const d = parseDate(selDate)
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    const guestStr = selGuest === 'konsult' ? konsultGuestLabel() : effectiveGuests ? guestsWithUnit(effectiveGuests) : t('人数未定')
    const baseDetail = `${fmtDateLang(selDate, lang)}　${selTime}〜${addMin(selTime, selStayMin, lang)}\n${guestStr}${isKasshiki ? t('（貸切）') : ''}`
    const doneTitle = isKasshiki ? t('貸切お申し込みを受け付けました') : t('ご予約を承りました')
    const commonPayload = {
      lineUserId: profile?.userId || 'unknown', idToken,
      displayName: profile?.displayName || '',
      pictureUrl: profile?.pictureUrl || '',
      name: String(name).trim(),
      phone: String(phone).trim(),
      time: selTime,
      guests: effectiveGuests || '未定',
      course: visibleCourses[selCourse]?.name || itemLabel,
      isKasshiki,
      isKonsult,
      notes: buildNotesPayload(),
      q1: isQ1Other(q1) ? (q1Other.trim() || q1) : q1,
      q2: '',
      q3: isQ3Other(q3) ? (q3Other.trim() || q3) : q3,
      requestedStaff: staffAssignmentEnabled ? selStaff : '',
      email: emailCollectionEnabled ? String(email).trim() : '',
      language: lang,
    }
    // 定期予約（シリーズ予約）：貸切・大人数相談時は上のUIで選択自体を出していないが、念のため
    // ここでも二重にガードする（isKasshiki/isKonsultなら常に通常の単発予約フローに倒す）。
    const recurringActive = isRecurring && !isKasshiki && !isKonsult
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'confirm', title: doneTitle, pendingApproval: isKasshiki })
    setScreen('done')
    try {
      if (recurringActive) {
        const dates = buildRecurringDates(dateStr, recurringFrequency, recurringCount, customIntervalWeeks)
        const r = await api.createRecurringReservation({ ...commonPayload, dates })
        if (r.success) {
          const failedDates = (r.results || []).filter(x => !x.success).map(x => x.date)
          const summary = failedDates.length > 0
            ? (lang === 'en'
              ? `Confirmed: ${r.successCount} / Not confirmed: ${r.failCount} (${failedDates.join(', ')})\nWe'll contact you individually about the booking(s) that couldn't be confirmed.`
              : `確定：${r.successCount}回／不成立：${r.failCount}回（${failedDates.join('、')}）\n不成立の回は個別にご連絡します。`)
            : (lang === 'en' ? `All ${r.successCount} bookings confirmed.` : `全${r.successCount}回、すべて確定しました。`)
          setDone({ detail: baseDetail + '\n\n📅 ' + summary, id: '', pending: false, error: '', backScreen: 'confirm', title: doneTitle, pendingApproval: false })
          clearBookingDraft()
        } else {
          setDone(prev => ({ ...prev, pending: false, error: r.error || t('予約に失敗しました') }))
        }
        setSubmitting(false)
        return
      }
      const r = await api.createReservation({ ...commonPayload, date: dateStr })
      if (r.success) {
        const doneMsg = isKasshiki
          ? baseDetail + '\n\n' + t('内容を確認後、ご連絡いたします。')
          : baseDetail + t('\n\nLINEに確認メッセージをお送りしました。')
        setDone({ detail: doneMsg, id: `${t('予約番号：')}${r.reservationId}`, pending: false, error: '', backScreen: 'confirm', title: doneTitle, pendingApproval: isKasshiki })
        clearBookingDraft()
      } else {
        setDone(prev => ({ ...prev, pending: false, error: r.error || t('予約に失敗しました') }))
      }
    } catch (e) {
      setDone(prev => ({ ...prev, pending: false, error: t('通信エラーが発生しました') + ': ' + (e?.message || '') }))
    }
    setSubmitting(false)
  }

  // ===== 予約一覧 =====
  // ゲスト利用（LINEを使わない/使えないお客様）は、セッションごとに変わる仮のIDでは過去の予約を引けないため、
  // 電話番号を入力してもらい、それをキーに検索する（LINEユーザーは従来通りuserIdで自動検索）。
  async function openMyRes() {
    // 「マイ予約」は入力画面から意図的に離れる操作（既存の予約を確認したいだけで、今の入力内容を
    // 続けるつもりとは限らない）。ここでsessionStorageの下書きを消しておかないと、この後LIFFの
    // WebViewが破棄される／お客様がLINEのトーク一覧経由で予約画面を開き直す等でページが再読み込み
    // されると、restoreBookingDraftIfAny（1213行目付近）はscreen='input'に戻す際に必ず走るため、
    // 「マイ予約を見に来ただけ」のはずが、次に始めるはずの新規予約の入力画面に古い日時・氏名等が
    // 何の説明もなく勝手に入った状態で出てきてしまう（ランダム客層視点レビュー・ラウンド45での指摘）。
    // 同一セッション内でこの画面下部の「← 戻る」を押して入力画面に戻るだけなら、Reactのstate自体は
    // まだメモリ上に残っているため入力内容は失われず、screen==='input'に戻った時点の永続化useEffect
    // （1194行目付近）がそのまま最新の内容をsessionStorageへ書き戻すので、ここで消しても支障はない。
    clearBookingDraft()
    setMyRes([])
    setMyWaitlist([])
    setMyResErr('')
    setCancelId(null)
    setScreen('myres')
    if (isGuestMode) {
      setMyResNeedsPhone(true)
      return
    }
    setMyResLoading(true)
    try {
      const r = await api.getMyReservations(profile?.userId || '', undefined, undefined, idToken)
      if (r.success) setMyRes(r.list || [])
      else { setMyRes([]); setMyResErr(t('予約の読み込みに失敗しました。もう一度お試しください。')) }
    } catch {
      setMyRes([])
      setMyResErr(t('通信エラーが発生しました。もう一度お試しください。'))
    }
    setMyResLoading(false)
    // キャンセル待ちの取得はあくまで付随情報のため、失敗してもマイ予約本体の表示には影響させない
    // （myResErrとは別に扱い、ここの失敗時は単に何も表示しない＝空リストのまま）。
    try {
      const wr = await api.getMyWaitlist(profile?.userId || '', undefined, undefined, idToken)
      if (wr.success) setMyWaitlist(wr.list || [])
    } catch { /* 付随情報のため無視 */ }
  }

  async function lookupMyResByPhone() {
    if (!myResNameInput.trim()) { setMyResErr(t('お名前を入力してください')); return }
    if (!myResPhoneInput.trim()) { setMyResErr(t('電話番号を入力してください')); return }
    setMyResErr('')
    setMyResLoading(true)
    try {
      const r = await api.getMyReservations('', myResPhoneInput.trim(), myResNameInput.trim())
      if (r.success) {
        setMyRes(r.list || [])
        setMyResPhoneUsed(myResPhoneInput.trim())
        setMyResNameUsed(myResNameInput.trim())
        setMyResNeedsPhone(false)
      } else { setMyResErr(r.error || t('予約の読み込みに失敗しました。もう一度お試しください。')) }
    } catch {
      setMyResErr(t('通信エラーが発生しました。もう一度お試しください。'))
    }
    setMyResLoading(false)
    try {
      const wr = await api.getMyWaitlist('', myResPhoneInput.trim(), myResNameInput.trim())
      if (wr.success) setMyWaitlist(wr.list || [])
    } catch { /* 付随情報のため無視 */ }
  }

  // キャンセル待ち登録の取り消し（マイ予約のexecCancelと同じ「本当に良いか」確認パターン）。
  async function execWaitlistCancel(id) {
    setWlCancelingId(id)
    setWlCancelErr('')
    try {
      const r = await api.cancelMyWaitlistEntry({ id, lineUserId: profile?.userId || '', idToken, phone: myResPhoneUsed, name: myResNameUsed })
      if (r.success) {
        setMyWaitlist((prev) => prev.filter((x) => x.id !== id))
        setWlCancelConfirmId(null)
      } else {
        setWlCancelErr(r.error || t('取り消しに失敗しました。お手数ですがお電話にてご連絡ください。'))
      }
    } catch {
      setWlCancelErr(t('通信エラーが発生しました。もう一度お試しいただき、失敗する場合はお電話にてご連絡ください。'))
    }
    setWlCancelingId(null)
  }

  async function execCancel(id) {
    setCancelingId(id)
    setCancelErr('')
    try {
      const r = await api.cancelReservation({ reservationId: id, lineUserId: profile?.userId || '', idToken, phone: myResPhoneUsed, name: myResNameUsed })
      if (r.success) {
        setMyRes((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'キャンセル' } : x)))
        setCancelId(null)
      } else {
        setCancelErr(r.error || t('キャンセルに失敗しました。お手数ですがお電話にてご連絡ください。'))
      }
    } catch {
      setCancelErr(t('通信エラーが発生しました。もう一度お試しいただき、失敗する場合はお電話にてご連絡ください。'))
    }
    setCancelingId(null)
  }

  // 見積/承認フロー：承諾・辞退のいずれも予約自体のステータスは変えない（バックエンドの
  // respondToEstimate参照）。表示だけその場でestimateStatusを更新する。
  async function respondEstimate(id, accept) {
    setEstimateRespondingId(id)
    setEstimateRespondErr('')
    setEstimateRespondErrId(null)
    try {
      const r = await api.respondToEstimate({ reservationId: id, lineUserId: profile?.userId || '', idToken, phone: myResPhoneUsed, name: myResNameUsed, accept })
      if (r.success) {
        setMyRes((prev) => prev.map((x) => (x.id === id ? { ...x, estimateStatus: accept ? '承諾済み' : '辞退済み' } : x)))
      } else {
        setEstimateRespondErr(r.error || t('操作に失敗しました。お手数ですがお電話にてご連絡ください。'))
        setEstimateRespondErrId(id)
      }
    } catch {
      // キャンセル（execCancel）・シリーズまとめてキャンセル（cancelSeriesAll）は通信エラー時も
      // 「失敗する場合はお電話にてご連絡ください」まで文言に含めているのに、この見積応答（承諾/辞退）
      // だけ「もう一度お試しください」のみで電話への逃げ道が無く、繰り返し失敗すると詰んでいた
      // （ランダム客層視点レビュー・ラウンド43での指摘：確立済みパターンからの抜け漏れ）。
      setEstimateRespondErr(t('通信エラーが発生しました。もう一度お試しいただき、失敗する場合はお電話にてご連絡ください。'))
      setEstimateRespondErrId(id)
    }
    setEstimateRespondingId(null)
  }

  // 定期予約（シリーズ予約）のまとめてキャンセル。個々の回はcancelReservationがそのまま使える
  // （各回は完全に独立した通常の予約のため）ので、このボタンはシリーズ全体をまとめたい時だけ使う。
  async function cancelSeriesAll(seriesId) {
    setSeriesCancelingId(seriesId)
    setSeriesCancelErr('')
    setSeriesCancelErrId(null)
    try {
      const r = await api.cancelSeries({ seriesId, lineUserId: profile?.userId || '', idToken, phone: myResPhoneUsed, name: myResNameUsed })
      if (r.success) {
        setMyRes((prev) => prev.map((x) => (x.seriesId === seriesId && x.date >= toYMD(new Date()).replace(/-/g, '/') ? { ...x, status: 'キャンセル' } : x)))
      } else {
        setSeriesCancelErr(r.error || t('キャンセルに失敗しました。お手数ですがお電話にてご連絡ください。'))
        setSeriesCancelErrId(seriesId)
      }
    } catch {
      setSeriesCancelErr(t('通信エラーが発生しました。もう一度お試しいただき、失敗する場合はお電話にてご連絡ください。'))
      setSeriesCancelErrId(seriesId)
    }
    setSeriesCancelingId(null)
  }

  // ===== 変更フォーム =====
  function openChangeForm(res) {
    setChangingRes(res)
    setChgDate('')
    setChgTime('')
    setChgGuests(/^\d+$/.test(String(res.guests)) ? String(res.guests) : '')
    setChgMsg('')
    setChgErr('')
    setChgResGone(false)
    setAvail(null)
    // wlDone/wlErrは新規予約フローと共有のstate。変更フローに満席日のキャンセル待ち案内を追加したことで、
    // 別の日付・別の画面で過去に登録済み／エラーになった状態がそのまま持ち越されて見えてしまう
    // （例：新規予約フローで別日のキャンセル待ちに登録済みのまま変更フローを開くと、まだ登録していない
    // 変更先の日付でも「✅登録しました」と誤表示される）。onDateChange（748行目）と同様にリセットする。
    setWlDone(false)
    setWlErr('')
    setWlNotifyCondition('anyTime')
    // privacyConsentは新規予約確認画面等と共有のstate。前の画面で入れたチェックが持ち越されると、
    // 変更内容の確認画面で「一度も明示的に同意していないのにチェック済み」に見えてしまう
    // （Apple CEO・ランダム客層の両視点が独立発見・ラウンド30での指摘）。
    setPrivacyConsent(false)
    const now = new Date()
    setCalYear(now.getFullYear())
    setCalMonth(now.getMonth())
    setScreen('change')
  }

  async function onChgDateChange(d) {
    setChgDate(d)
    setChgTime('')
    setChgGuests('')
    setChgErr('')
    setAvail(null)
    setAvailErr('')
    setWlDone(false)
    setWlErr('')
    setWlNotifyCondition('anyTime')
    if (d) {
      // 空席取得は祝日データに依存しないため、onDateChangeと同様に並行して開始する。
      fetchAvailability(d, undefined, changingRes?.course)
      ensureHolidays()
    }
  }

  // 変更後の人数ボタン用：同じ枠のまま人数だけ増やす場合は、自分自身の予約分の席を残席に加算して判定する。
  // 以前は「日付が同じか」しか見ておらず、timeSlot容量モデルで同じ日の別の時間帯へ変更しようとした
  // 場合にも自分の元予約人数を加算してしまい、実際より多く空いているように見せてしまっていた
  // （バックエンドのgetCalendarAvailabilityはexcludeCalIdで正しく除外判定するため最終的には
  // エラーで弾かれるが、確認画面まで進めた直後に失敗する体験の悪さに直結する。審判団バックログ
  // 一括レビューでの指摘）。dailyモデルは元々「その日1晩」を1つのプールとして数えるため、時間が
  // 違っても同日なら自分の分を除外し続けるのが正しい。timeSlot/perStaffモデルは、時間まで一致する
  // 場合だけ「同じ枠」として自分の分を除外する。
  function chgGuestDisabled(n) {
    if (availErr) return true
    if (!avail || availLoading) return false
    const sameDate = changingRes && chgDate && chgDate.replace(/-/g, '/') === changingRes.date
    const sameSlot = sameDate && (capacityModel === 'daily' || chgTime === changingRes.time)
    const ownSeats = sameSlot ? (parseInt(changingRes.guests) || 0) : 0
    if (n === 1) return !avail.canBook1
    if (capacityModel === 'perStaff') return n >= 2 && !avail.canBook2to5
    if (n >= 2) return n > (avail.remainingSeats + ownSeats)
    return false
  }

  async function submitChange() {
    // 確認画面（chgconfirm）へ遷移した後にgetMyReservationsの裏取り応答が届き、chgResGoneがtrueに
    // なるケースへの最終防波堤（確認へボタン側のガードと同じ理由）。ここで弾いてもOptimistic UI
    // （setDone→setScreen('done')）にまだ入っていないため、お客様には通常のエラー表示のまま戻せる。
    if (chgResGone) { setChgcfErr(t('この予約は既に変更またはキャンセルされているため、続行できません。お手数ですが「マイ予約」から最新の状況をご確認ください。')); return }
    setChgSubmitting(true)
    setChgcfErr('')
    const d = parseDate(chgDate)
    const nd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    // submitReservation（941行目）と同じくfmtDateLang/t('名様')を使う。以前はfmtDate（日本語専用の
    // M月D日（曜）表記）と「名様」ハードコードのままで、変更完了直後の画面だけ英語モードでも
    // 日本語のまま表示されていた（ランダム客層視点レビューでの指摘）。
    const baseDetail = `${fmtDateLang(chgDate, lang)}　${chgTime}〜${addMin(chgTime, chgStayMin, lang)}\n${guestsWithUnit(effectiveChgGuests)}`
    // Optimistic UI：先に done 画面へ遷移し、API はバックグラウンドで送信
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'chgconfirm', title: t('変更が完了しました') })
    setScreen('done')
    try {
      const r = await api.changeReservation({
        reservationId: changingRes.id,
        lineUserId: profile?.userId || '', idToken,
        phone: myResPhoneUsed,
        name: myResNameUsed,
        newDate: nd,
        newTime: chgTime,
        newGuests: effectiveChgGuests,
        message: chgMsg.trim(),
      })
      if (r.success) {
        setDone({ detail: baseDetail + t('\n\nLINEに変更確認メッセージをお送りしました。'), id: `${t('予約番号：')}${changingRes.id}`, pending: false, error: '', backScreen: 'chgconfirm', title: t('変更が完了しました') })
        clearChangeDraft()
      } else {
        setDone(prev => ({ ...prev, pending: false, error: r.error || t('変更に失敗しました') }))
      }
    } catch {
      setDone(prev => ({ ...prev, pending: false, error: t('通信エラーが発生しました') }))
    }
    setChgSubmitting(false)
  }

  // ===== レンダリング =====
  return (
    <>
      <Head>
        {/* タイトル・説明文の固定部分（店名を除く）は言語切替に追従させる。店舗が入力した紹介文（bizTagline）
            自体は自由記述のコンテンツのため翻訳対象外（他の店舗入力コンテンツと同じ扱い。Google CEO視点
            レビューでの指摘：UIは英語に切り替わるのにタブのタイトル・共有時のプレビューだけ日本語のまま
            残っていた）。 */}
        <title>{lang === 'en' ? `${bizName} - Reservation` : `${bizName} ご予約`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* LINEアプリ内WebViewやモバイルブラウザのアドレスバー等の色を、このページのヘッダー配色
            （--green）に合わせる（アップルデザインチーム視点レビューでの指摘：無くても壊れないが、
            LIFF埋め込みの予約導線として「ネイティブっぽい」統一感が出る一行で安価な改善）。 */}
        <meta name="theme-color" content="#06c755" />
        {/* LINEのトーク画面・SNSでこのURLが共有された際に、リンクプレビュー（店名・説明・写真）が
            出るようにするための最低限のメタタグ（Google CEO視点レビューでの指摘：実店舗を持つ業態にとって
            「予約リンクを外部でシェアした時の見え方」は集客に直結するため）。店舗紹介写真を設定していない
            店舗ではog:imageを省略する（無い画像を無理に参照させない）。 */}
        <meta name="description" content={bizTagline || (lang === 'en' ? `Book your reservation at ${bizName}` : `${bizName}のご予約はこちらから`)} />
        <meta property="og:title" content={lang === 'en' ? `${bizName} - Reservation` : `${bizName} ご予約`} />
        <meta property="og:description" content={bizTagline || (lang === 'en' ? `Book your reservation at ${bizName}` : `${bizName}のご予約はこちらから`)} />
        <meta property="og:type" content="website" />
        {storeImageUrl && <meta property="og:image" content={storeImageUrl} />}
        {/* JSON.stringifyは<をエスケープしないため、店舗名・紹介文等（管理画面から設定可能な値）に
            </script><script>...のような文字列が含まれると、そのままHTMLに埋め込まれてスクリプトタグが
            分断され、公開ページ全訪問者に実行されるstored XSSになりうる（ITコンサル視点レビューでの指摘）。
            <へ変換して無害化する。 */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': BUSINESS_CATEGORY_SCHEMA_TYPES[businessCategory] || 'LocalBusiness',
          name: bizName,
          description: bizTagline || undefined,
          telephone: bizPhone || undefined,
          image: storeImageUrl || undefined,
          address: bizAddress ? { '@type': 'PostalAddress', streetAddress: bizAddress, addressCountry: 'JP' } : undefined,
          // dailyHoursは残席計算に既に使っているデータをそのまま流用（Google CEO視点レビューでの指摘：
          // 「営業時間データは既にある」ので追加取得なしで構造化データに載せられる、という趣旨）
          openingHoursSpecification: buildOpeningHoursSpec(settingsDailyHours) || undefined,
        }).replace(/</g, '\\u003c') }} />
      </Head>

      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={initLiff}
        onError={() => {
          setProfile({ userId: 'guest_' + Date.now(), displayName: '' })
          setIsGuestMode(true)
          setScreen('input')
        }}
      />

      <div className="header">
        {storeImageUrl && (
          <img src={optimizedImageUrl(storeImageUrl, 800)} alt={bizName} decoding="async"
            style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }}
            onError={e => onOptimizedImageError(e, storeImageUrl)} />
        )}
        <h1>{bizName}</h1>
        <p>{bizTagline}</p>
        {enabledLanguages.length > 1 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center' }}>
            {enabledLanguages.map(code => {
              const l = LANGUAGES.find(x => x.code === code)
              return (
                <button key={code} onClick={() => setLang(code)}
                  aria-pressed={lang === code}
                  style={{
                    fontSize: 12, padding: '10px 16px', minHeight: 36, borderRadius: 14, cursor: 'pointer',
                    border: lang === code ? 'none' : '1px solid rgba(255,255,255,.6)',
                    background: lang === code ? 'var(--white)' : 'transparent',
                    color: lang === code ? 'var(--green)' : '#fff', fontWeight: lang === code ? 'bold' : 'normal',
                  }}>
                  {l ? l.label : code}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── LINEログイン選択（PC・LINE外ブラウザのみ） ── */}
      {screen === 'linechoice' && (
        <div className="scr">
          <div className="ld-wrap" style={{ paddingTop: 40 }}>
            <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 24, lineHeight: 1.7 }}>
              {t('ご予約方法をお選びください')}
            </p>
            <button className="btn-p" style={{ maxWidth: 320, margin: '0 auto' }}
              onClick={() => window.liff.login({ redirectUri: location.href })}>
              {t('LINEでログインして予約する')}
            </button>
            <p style={{ fontSize: 12, color: 'var(--hint)', maxWidth: 320, margin: '6px auto 0', lineHeight: 1.6 }}>
              {t('LINEアカウントをお持ちの方向けです。LINEのサイトに移動します')}
            </p>
            <button className="btn-s" style={{ maxWidth: 320, margin: '18px auto 0' }}
              onClick={proceedAsGuest}>
              {t('LINEを使わずに予約する')}
            </button>
            <p style={{ fontSize: 12, color: 'var(--hint)', maxWidth: 320, margin: '6px auto 0', lineHeight: 1.6 }}>
              {t('LINEアカウントが無い方・お持ちでない方はこちら。お名前と電話番号でご予約いただけます')}
            </p>
          </div>
        </div>
      )}

      {/* ── LOADING ── */}
      {screen === 'loading' && (
        <div className="scr">
          <div className="ld-wrap">
            <div className="dots">
              <div className="dot" /><div className="dot" /><div className="dot" />
            </div>
            <p className="ld-txt">{t('読み込み中...')}</p>
            {longWait && (
              // role="status" aria-live="polite"：このブロック自体はタイマーで無音に出現するため、
              // ファイル内の他の動的メッセージ（role="alert"のエラー群等）と同じく出現をスクリーン
              // リーダーにも伝える（Appleデザインチーム視点レビュー・ラウンド43での指摘）。
              // エラーではないためpolite（assertiveだと読み込み中の他の案内を遮ってしまう）。
              <div role="status" aria-live="polite">
                <p className="ld-txt" style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>{t('通信状況により、時間がかかる場合があります。しばらくお待ちください。')}</p>
                {/* タイマー任せの自動フォールバック（9秒）だけでなく、待たされている本人が今すぐ
                    進める手段も用意する（ランダム客層視点レビュー・ラウンド42での指摘）。ボタンは
                    既存のセカンダリCTA（linechoice画面の「LINEを使わずに予約する」等）と同じ
                    .btn-sクラスを使うことで見た目・タップ領域（padding15px×width100%）を統一し、
                    ラベルのみで動作が伝わるためaria-labelは不要（Appleデザインチーム視点レビュー・
                    ラウンド43での確認）。 */}
                <button className="btn-s" style={{ maxWidth: 320, margin: '14px auto 0' }}
                  onClick={proceedAsGuest}>
                  {t('続ける（ゲストとして予約する）')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── INPUT FORM ── */}
      {screen === 'input' && (
        <div className="scr">
          {/* 下書き復元の案内（詳細はbookingDraftRestoredの宣言部コメント参照）。エラーではないため
              role="status"・politeで、見た目も他のエラーバナーと紛らわしくないよう案内色（info）にする。 */}
          {bookingDraftRestored && (
            <div role="status" aria-live="polite" style={{ background:'var(--info-bg)', border:'1px solid var(--info-border)', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:13, color:'var(--info-text)' }}>
              {t('前回入力いただいた内容を復元しました。内容をご確認のうえ、続きをご入力ください')}
            </div>
          )}
          {isGuestMode && (
            <div style={{ background:'var(--info-bg)', border:'1px solid var(--info-border)', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:13, color:'var(--info-text)' }}>
              {t('LINEなしでご予約いただけます。ご予約の確認・変更・キャンセルは「マイ予約」から電話番号で検索できます')}{emailCollectionEnabled ? t('（メールアドレスをご登録いただくと確認メールもお送りします）') : ''}{t('。お困りの際はお電話（')}<a href={telHref(bizPhone)} style={{ color:'var(--info-text)', fontWeight:'bold' }}>{bizPhone}</a>{t('）にもご連絡いただけます。')}
            </div>
          )}
          {/* コース（コース無しモードでは選択UI自体を表示しない） */}
          {!isSimpleMode && (
          <div className="card">
            <h2 className="card-lbl" id="course-group-lbl">{itemIcon}　{itemLabel}</h2>
            {/* コース選択がマウスクリックのみのdivで、キーボード操作・スクリーンリーダーでは選択肢の
                存在自体が伝わらなかった（累積指摘の総棚卸しでの指摘）。role/tabIndex/キーボード操作を
                追加し、見た目（レイアウト・スタイル）は変更しない。 */}
            <div className="card-body" role="radiogroup" aria-labelledby="course-group-lbl">
              {visibleCourses.map((c, i) => {
                const selectCourse = () => {
                  if (visibleCourses.length <= 1) return
                  setSelCourse(i)
                  // コースにより提供時間帯（ランチ/ディナー等）が変わるため、選択済みの時間はリセットする（人数はそのまま維持）
                  setSelTime('')
                  setInputErr('')
                  // コースが変わると滞在時間・残席計算の前提が変わるため、別コースの古い残席情報を
                  // 一瞬でも見せてしまわないようクリアする（時間を選び直すまで表示しない）
                  setAvail(null)
                  setAvailErr('')
                  // 時間・担当者・人数変更時と同じ理由（コースが変わると提供時間帯自体が変わるため、
                  // 満席カードで既に登録済みの✅表示が別コースにも持ち越されてしまう。ランダム客層視点
                  // レビュー・ラウンド38での指摘）。
                  setWlDone(false); setWlErr('')
                }
                return (
                <div key={i}
                  className={`course-item${visibleCourses.length > 1 ? (selCourse === i ? ' sel' : '') : ''}`}
                  onClick={selectCourse}
                  role={visibleCourses.length > 1 ? 'radio' : undefined}
                  aria-checked={visibleCourses.length > 1 ? selCourse === i : undefined}
                  tabIndex={visibleCourses.length > 1 ? 0 : undefined}
                  onKeyDown={visibleCourses.length > 1 ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCourse() } }) : undefined}
                  style={visibleCourses.length > 1 ? { cursor:'pointer', border: selCourse===i ? '2px solid var(--green)' : '2px solid var(--border)', borderRadius:10, padding:'10px 12px', marginBottom: i < visibleCourses.length-1 ? 8 : 0 } : {}}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {c.imageUrl && (
                      <img src={optimizedImageUrl(c.imageUrl, 112)} alt={c.name} loading="lazy" decoding="async"
                        style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        onError={e => onOptimizedImageError(e, c.imageUrl)} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="course-row">
                        {/* コースカードの選択状態が枠線の色（border-color: var(--green) vs var(--border)）のみで
                            示されており、色を判別しづらい弱視のお客様には選択中かどうかが伝わらなかった
                            （aria-checkedは既にあるためスクリーンリーダー上は問題無いが、色以外の視覚的な
                            手がかりが無かった。Appleデザインチーム視点レビュー・ラウンド44での指摘：round41から
                            の「色のみの選択状態」バックログの定義的な棚卸し）。カレンダーの選択マス（✓表示）と
                            同じ手法で、選択中は名称の前に✓を付ける。 */}
                        <div className="course-nm">{visibleCourses.length > 1 && selCourse === i ? '✓ ' : ''}{c.name}</div>
                        <div className="course-pr">¥{Number(c.price).toLocaleString()}<small>{lang === 'en' ? ' (tax incl.)' : '（税込）'}</small></div>
                      </div>
                      {c.description && <div className="course-dc">{c.description}</div>}
                      <div>
                        <span className="tag">{fmtDuration(c.duration, lang)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>
          )}

          {/* 来店日 */}
          <div className="card" id="card-date">
            <h2 className="card-lbl">{visitText('📅　ご来店日')}</h2>
            <div className="card-body" style={{ position: 'relative' }}>
              {monthAvailLoading && (
                <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1, minHeight:180 }}>
                  <span style={{ fontSize:13, color:'var(--hint)' }}>{t('カレンダー取得中...')}</span>
                </div>
              )}
              <CustomerCalendar
                year={calYear} month={calMonth}
                monthAvail={monthAvail}
                dateMin={dateMin} dateMax={dateMax}
                selected={selDate}
                onSelect={(d) => onDateChange(d)}
                onPrev={() => { if (calMonth === 0) { setCalYear(y=>y-1); setCalMonth(11) } else setCalMonth(m=>m-1) }}
                onNext={() => { if (calMonth === 11) { setCalYear(y=>y+1); setCalMonth(0) } else setCalMonth(m=>m+1) }}
                loading={monthAvailLoading}
                lang={lang}
              />
              {selDate && <p className="deadline-note" style={{ marginTop:10 }}>⏳ {deadlineLabel(selDate)}</p>}
            </div>
          </div>

          {/* 来店時間 */}
          {showTimeCard && (
            <div className="card" id="card-time">
              <h2 className="card-lbl">
                {visitText('⏰　来店時間')}
                {!selTime && availLoading && <span className="avail-loading"> {t('確認中...')}</span>}
              </h2>
              <div className="card-body">
                {selDate && courseTimeSlots.length === 0 ? (
                  <p className="hint">{t('この日はご案内できる時間帯がありません。別の日をお選びください。')}</p>
                ) : (
                  <>
                    <TimeGrid value={selTime} onChange={(s) => { setSelTime(s); setInputErr(''); setWlDone(false); setWlErr(''); if (selDate) fetchAvailability(selDate, s, visibleCourses[selCourse]?.name, staffAssignmentEnabled ? selStaff : undefined) }} slots={courseTimeSlots} />
                    <p className="hint">
                      {courseTimeSlots.length > 0
                        ? (lang === 'en'
                          ? `Available ${formatTimeSlotRanges(courseTimeSlots)} (${fmtDuration(selStayMin, lang)})`
                          : `受付時間 ${formatTimeSlotRanges(courseTimeSlots)}（コースは${fmtDuration(selStayMin, lang)}）`)
                        : ''}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 人数 */}
          {showGuestCard && (
            <div className="card" id="card-guest">
              <h2 className="card-lbl">
                {t('👥　人数')}
                {availLoading && <span className="avail-loading"> {t('確認中...')}</span>}
                {avail && !availLoading && !isKasshiki && (
                  <span className="avail-info">
                    {lang === 'en'
                      ? (capacityModel === 'perStaff' ? ` ${avail.remainingSeats} ${staffLabel} available` : ` ${avail.remainingSeats} ${countUnit} remaining`)
                      : (capacityModel === 'perStaff' ? ` 対応可能な${staffLabel} ${avail.remainingSeats}${countUnit}` : ` 残り ${avail.remainingSeats}${countUnit}`)}
                  </span>
                )}
              </h2>
              <div className="card-body" style={{ position: 'relative' }}>
                {availLoading && (
                  <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1 }}>
                    <span style={{ fontSize:13, color:'var(--hint)' }}>{capacityModel === 'perStaff' ? staffCheckingText() : t('空き状況を確認中...')}</span>
                  </div>
                )}
                {availErr && !availLoading && (
                  <div role="alert" aria-live="polite" style={{ background:'var(--danger-bg)', border:'1px solid var(--danger-border)', borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:13, color:'var(--red)' }}>
                    {availErr}
                    <button onClick={() => fetchAvailability(selDate, selTime, visibleCourses[selCourse]?.name, staffAssignmentEnabled ? selStaff : undefined)}
                      style={{ marginLeft:8, background:'var(--white)', border:'1px solid var(--red)', color:'var(--red)', borderRadius:6, padding:'12px 16px', minHeight:44, minWidth:44, fontSize:13, fontWeight:'bold', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                      {t('再試行')}
                    </button>
                  </div>
                )}
                <div className="g-row">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => {
                    const disabled = guestDisabled(n) || monthAvailLoading || isKasshiki
                    const isOccupied = !isKasshiki && avail && !availLoading && !monthAvailLoading && guestDisabled(n)
                    return (
                      <button
                        key={n}
                        className={`g-btn${selGuest === String(n) && !isKasshiki ? ' sel' : ''}${disabled ? ' dis' : ''}`}
                        disabled={disabled}
                        aria-pressed={selGuest === String(n) && !isKasshiki}
                        onClick={() => {
                          if (disabled) return
                          setSelGuest(String(n))
                          setIsKasshiki(false)
                          setIsKonsult(false)
                          setShowKasshikiWarning(false)
                          setInputErr('')
                          // 時間・担当者変更時と同じ理由（人数を変えると満席カードの対象自体が変わるのに、
                          // 既に登録済みの✅表示だけが残ってしまう。ランダム客層視点レビュー・ラウンド38
                          // での指摘：時間・担当者変更時のリセットだけ追加され、人数変更時が漏れていた）。
                          setWlDone(false); setWlErr('')
                        }}
                      >
                        {/* 単位が「名」固定でcountUnit設定（台・件等）を反映していなかった（残席表示・
                            単価表示は既にcountUnitを使っているのに、この人数選択ボタンだけ取り残されて
                            いた）。英語表記は、店舗が単位をカスタマイズしていない大多数の店舗ではこれまで
                            通り自然な"guest(s)"のまま、カスタマイズされている場合は他の箇所（1013・1474行目
                            付近）と同じくcountUnitの値をそのまま添える形にする（審判団バックログ一括
                            レビューでの指摘）。 */}
                        {/* この人数ボタンはcountUnit（資産側の数え方）ではなく、乗る／使う人の頭数を
                            表すguestUnitを使う（perStaffの車両・器材等ではcountUnitと別概念のため。
                            1244行目付近のguestUnit定義コメント参照、業種経営者陣視点レビュー・第43回）。 */}
                        <span className="g-btn-main">{lang === 'en'
                          ? (guestUnit === '名' ? `${n} guest${n === 1 ? '' : 's'}` : `${n} ${guestUnit}`)
                          : `${n}${guestUnit}`}</span>
                        {isOccupied && <span className="g-btn-sub">{n === 1 ? t('条件あり') : t('満席')}</span>}
                      </button>
                    )
                  })}
                </div>

                {/* 満席日：キャンセル待ち登録（貸切が理由の満席は下の専用の案内を出すので、ここでは対象外にする） */}
                {featureFlags.waitlistEnabled && avail && !availLoading && !isKasshiki && !avail.hasKasshiki && avail.remainingSeats === 0 && (
                  <div style={{ background:'var(--warning-bg)', border:'1px solid var(--warning-border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>{t('この日は満席です。キャンセルが出た際にお知らせすることができます（先着順のためご案内をお約束するものではありません）。')}</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')} aria-label={t('お名前')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')} aria-label={t('電話番号')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                        </div>
                        {/* 時間帯・担当者制の業態でだけ表示する。'daily'業態（日付単位で元々正しい判定）では
                            この選択自体が無意味なので出さない（業種経営者陣視点レビュー・ラウンド30での
                            指摘、ユーザー承認済み：「通知内容・条件をお客様に選ばせる」）。 */}
                        {capacityModel !== 'daily' && (
                          <div style={{ marginBottom:8, fontSize:12, color:'var(--sub)' }}>
                            <div style={{ marginBottom:4 }}>{t('どのように通知しますか？')}</div>
                            <label style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2, cursor:'pointer' }}>
                              <input type="radio" checked={wlNotifyCondition === 'strict'} onChange={() => setWlNotifyCondition('strict')} />
                              <span>{waitlistStrictLabel()}</span>
                            </label>
                            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                              <input type="radio" checked={wlNotifyCondition === 'anyTime'} onChange={() => setWlNotifyCondition('anyTime')} />
                              <span>{t('同じ日ならいつでも良いので、空きが出たら通知する')}</span>
                            </label>
                          </div>
                        )}
                        {wlErr && <div role="alert" aria-live="polite" style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {/* キャンセル待ち登録も氏名・電話番号を収集するため、予約確定と同じ同意チェックを
                            必須にする（Apple CEO視点レビューでの指摘：確認画面を経由しないこの経路だけ
                            同意チェックをすり抜けていた） */}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warning-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                        )}
                        {/* 貸切満席カード（1501行目）には常に電話番号のリンクがあるのに、この通常の満席カードだけ
                            送信エラー時の逃げ道（電話番号）が無かった（ランダム客層視点レビューでの指摘：
                            見た目が近い2つのカードで、片方だけ詰みになる非対称な設計だった）。 */}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          <button onClick={() => joinWaitlist()} disabled={wlSubmitting || !privacyConsent}
                            style={{ background:'#ff9800', color:'#fff', border:'none', borderRadius:6, padding:'9px 16px', fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                            {wlSubmitting ? t('登録中...') : t('キャンセル待ちに登録する')}
                          </button>
                          {wlErr && <a href={telHref(bizPhone)} style={{ color:'var(--green)', fontWeight:'bold' }}>📞 {bizPhone}</a>}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 貸切・大人数相談ボタン（買い切り需要が無い業態向けに設定でまるごと非表示にできる） */}
                {featureFlags.kasshikiEnabled && (
                  <>
                    <button
                      className={`g-btn-k${isKasshiki ? ' sel' : ''}${kasshikiDisabled() || monthAvailLoading ? ' dis' : ''}`}
                      disabled={kasshikiDisabled() || monthAvailLoading}
                      aria-pressed={isKasshiki}
                      onClick={() => {
                        if (kasshikiDisabled()) return
                        const n = parseInt(selGuest) || 0
                        if (!selGuest || n < 6) {
                          setShowKasshikiWarning(true)
                        } else {
                          setIsKasshiki(true)
                          setInputErr('')
                        }
                      }}
                    >
                      {kasshikiDisabled() && avail ? t('🔒 貸切で予約する — 本日は受付不可') : t('🔒 貸切で予約する')}
                    </button>

                    <button
                      className={`g-btn-k${selGuest === 'konsult' ? ' sel' : ''}${konsultDisabled() || monthAvailLoading ? ' dis' : ''}`}
                      disabled={konsultDisabled() || monthAvailLoading}
                      aria-pressed={selGuest === 'konsult'}
                      style={{ marginTop: 6 }}
                      onClick={() => {
                        if (konsultDisabled()) return
                        setSelGuest('konsult')
                        setIsKasshiki(true)
                        setIsKonsult(true)
                        setShowKasshikiWarning(false)
                        setInputErr('')
                      }}
                    >
                      {konsultButtonLabel(konsultDisabled() && avail)}
                    </button>
                  </>
                )}

                {/* 貸切が既に埋まっている日：次の行動（キャンセル待ち・お電話）を案内する */}
                {featureFlags.kasshikiEnabled && avail && !availLoading && avail.hasKasshiki && (
                  <div style={{ background:'var(--input-bg)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {featureFlags.waitlistEnabled && wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>
                          {t('この日は貸切のご予約が入っているため、貸切・大人数でのご利用はできません。')}
                          {featureFlags.waitlistEnabled
                            ? t('キャンセルが出た際にお知らせすることもできます（先着順のためご案内をお約束するものではありません）。お急ぎの場合はお電話でご相談ください。')
                            : t('お急ぎの場合はお電話でご相談ください。')}
                        </div>
                        {featureFlags.waitlistEnabled && (
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')} aria-label={t('お名前')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')} aria-label={t('電話番号')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                          </div>
                        )}
                        {wlErr && <div role="alert" aria-live="polite" style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {featureFlags.waitlistEnabled && (
                          <>
                            <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                              <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                            </label>
                            {!privacyConsent && (
                              <div style={{ fontSize:11, color:'var(--warning-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                            )}
                          </>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          {featureFlags.waitlistEnabled && (
                            <button onClick={() => joinWaitlist(undefined, undefined, undefined, true)} disabled={wlSubmitting || !privacyConsent}
                              style={{ background:'#ff9800', color:'#fff', border:'none', borderRadius:6, padding:'9px 16px', fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                              {wlSubmitting ? t('登録中...') : t('キャンセル待ちに登録する')}
                            </button>
                          )}
                          <a href={telHref(bizPhone)} style={{ color:'var(--green)', fontWeight:'bold' }}>📞 {bizPhone}</a>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 貸切警告 */}
                {showKasshikiWarning && (
                  <div className="k-warning">
                    {!selGuest && <p className="k-warning-title">{t('人数未選択です。')}</p>}
                    {(() => {
                      // ||演算子だとpriceが意図的に0円（無料相談枠等、他業態展開時に実在しうる）の場合も
                      // 貝屋和光の実コース価格(11000)にフォールバックしてしまい、他業態で虚偽の金額を
                      // 表示する実害があった（Google/イーロン各視点が独立発見・審判団バックログ一括
                      // レビュー・ラウンド31での指摘）。Number.isFiniteで「未設定」と「明示的に0」を区別する。
                      const kPriceRaw = Number(visibleCourses[selCourse]?.price)
                      const kPrice = Number.isFinite(kPriceRaw) ? kPriceRaw : 11000
                      const kGuests = Math.max(6, parseInt(selGuest) || 0)
                      const kTotal = (kPrice * kGuests).toLocaleString()
                      // 貸切最低保証の対象人数（単位）が「名」固定で、店舗設定のcountUnit（台・件等）を
                      // 反映していなかった（累積指摘の総棚卸しでの指摘）。他の箇所と同じguestsWithUnit方式に統一する。
                      return lang === 'en' ? (
                        <p className="k-warning-body">Private-hire bookings require a <strong>minimum guaranteed spend for {guestsWithUnit(kGuests)} (¥{kTotal})</strong>.<br />Please only book if you agree to this.</p>
                      ) : (
                        <p className="k-warning-body">貸切プランのご利用には<strong>最低売上保証として{guestsWithUnit(kGuests)}分（¥{kTotal}）</strong>が発生いたします。<br />ご承知頂ける方のみご予約をお願いいたします。</p>
                      )
                    })()}
                    <div className="k-warning-btns">
                      <button className="btn-p" style={{ fontSize:14, padding:'13px' }} onClick={() => {
                        setIsKasshiki(true)
                        setShowKasshikiWarning(false)
                        setInputErr('')
                      }}>{t('承知しました')}</button>
                      <button className="btn-s" style={{ fontSize:14, padding:'13px', marginTop:8 }} onClick={() => setShowKasshikiWarning(false)}>{t('戻る')}</button>
                    </div>
                  </div>
                )}

                {isKasshiki && (
                  <div className="k-panel">
                    <p className="k-note">{t('内容を確認後、ご連絡いたします。')}</p>
                    {/* 同じ貸切パネル内、直後の最低保証額表示はguestsWithUnit()でcountUnit（台・件等）に対応
                        済みなのに、ここだけ「名」固定・英語版は単位自体が欠落していた取り残し
                        （ランダム客層視点レビュー・ラウンド36での指摘）。guestsWithUnit自体が言語分岐を
                        持つため、ここでは呼ぶだけでよい。 */}
                    {selGuest && selGuest !== 'konsult' && <p className="k-note" style={{ marginTop:4 }}>{(lang === 'en' ? 'Selected party size: ' : '選択人数：') + guestsWithUnit(selGuest)}</p>}
                    {selGuest === 'konsult' && <p className="k-note" style={{ marginTop:4 }}>{konsultGuestLabel()}</p>}
                    <button className="myres-link" style={{ marginTop:10, fontSize:13 }} onClick={() => {
                      setIsKasshiki(false)
                      setIsKonsult(false)
                      setSelGuest('')
                      setShowKasshikiWarning(false)
                    }}>{t('貸切をキャンセル')}</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 連絡先 */}
          <div className="card" id="card-contact">
            <h2 className="card-lbl">{t('📝　ご連絡先')}</h2>
            <div className="card-body">
              <input type="text" value={name} aria-label={t('お名前')}
                onChange={(e) => { setName(e.target.value); setInputErr('') }}
                placeholder={t('お名前（例：山田 太郎）')} />
              <input type="tel" value={phone} aria-label={t('電話番号')}
                onChange={(e) => { setPhone(e.target.value); setInputErr('') }}
                placeholder={t('電話番号（例：090-0000-0000）')}
                style={{ marginTop: 10 }} />
              {emailCollectionEnabled && (
                <>
                  <input type="email" value={email} aria-label={t('メールアドレス')}
                    onChange={(e) => { setEmail(e.target.value); setInputErr('') }}
                    placeholder={isGuestMode ? t('メールアドレス（確認メールをお送りします）') : t('メールアドレス（任意）')}
                    style={{ marginTop: 10 }} />
                  {isGuestMode && <p className="hint" style={{ marginTop: 6 }}>{t('LINEでのご案内が届かないため、確認・変更・キャンセルのためにメールアドレスをご登録ください。')}</p>}
                </>
              )}
            </div>
          </div>

          {/* その他の情報（任意）：現在はshowOptionalの初期値がtrueのため実質到達不能（dead code）だが、
              将来また折りたたみ表示に戻す改修が入った場合に備え、ボタン文言を実際のQ1見出し
              （q1Question、業態ごとにカスタマイズ可能）に連動させておく。以前は「ご利用目的」という
              飲食店向けの固定日本語のままで、展開後に表示される実際の見出し（例：整備工場なら
              「ご依頼内容」）と食い違っていた（Apple CEO視点レビュー・ラウンド29での指摘）。 */}
          {!showOptional ? (
            <button type="button" className="optional-toggle" onClick={() => setShowOptional(true)}>
              {(staffAssignmentEnabled && staffRoster.length > 0)
                ? `＋ ${t('ご指名')}・${(q1Question || t('ご利用目的')).replace(/（任意）$/, '')}・${t('ご要望等を追加する（任意）')}`
                : `＋ ${(q1Question || t('ご利用目的')).replace(/（任意）$/, '')}・${t('ご要望等を追加する（任意）')}`}
            </button>
          ) : (
            <>
              {/* Q1・Q2の見出し文言（q1Question/q3Question）も、選択肢（q1Options/q3Options）と同じく
                  店舗側の自由入力コンテンツになったため、翻訳対象外（t()を通さない）に統一した
                  （2026-08-08、質問文言自体を管理画面から変更できるようにした変更に伴う）。
                  プレースホルダー等の固定UI文言は引き続きt()経由で翻訳する。 */}
              {/* Q1 */}
              <div className="card">
                <h3 className="card-lbl card-lbl-optional">{`Q1. ${q1Question}`}</h3>
                <div className="card-body">
                  <div className="q-btn-row">
                    {q1Options.map(opt => (
                      <button key={opt} className={`q-btn${q1 === opt ? ' sel' : ''}`} aria-pressed={q1 === opt}
                        onClick={() => { setQ1(q1 === opt ? '' : opt); setQ1Other('') }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  {isQ1Other(q1) && (
                    <textarea rows={2} value={q1Other} onChange={e => setQ1Other(e.target.value)}
                      placeholder={t('具体的にご記入ください')} style={{ marginTop:10 }} />
                  )}
                </div>
              </div>

              {/* Q2 */}
              <div className="card">
                <h3 className="card-lbl card-lbl-optional">{`Q2. ${q3Question}`}</h3>
                <div className="card-body">
                  <div className="q-btn-row">
                    {q3Options.map(opt => (
                      <button key={opt} className={`q-btn${q3 === opt ? ' sel' : ''}`} aria-pressed={q3 === opt}
                        onClick={() => { setQ3(q3 === opt ? '' : opt); setQ3Other('') }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  {isQ3Other(q3) && (
                    <textarea rows={2} value={q3Other} onChange={e => setQ3Other(e.target.value)}
                      placeholder={t('具体的にご記入ください')} style={{ marginTop:10 }} />
                  )}
                </div>
              </div>

              {/* ご指名（担当者を指名できる業態のみ表示） */}
              {staffAssignmentEnabled && staffRoster.length > 0 && (
                <div className="card">
                  <h3 className="card-lbl card-lbl-optional">{t('🔖 ご指名（任意）')}</h3>
                  <div className="card-body">
                    <div className="q-btn-row" style={{ opacity: availLoading ? 0.6 : 1 }}>
                      <button disabled={availLoading} className={`q-btn${selStaff === '' ? ' sel' : ''}`} aria-pressed={selStaff === ''} onClick={() => { setSelStaff(''); setWlDone(false); setWlErr(''); if (selDate && selTime) fetchAvailability(selDate, selTime, visibleCourses[selCourse]?.name, undefined) }}>
                        {t('指名なし')}
                      </button>
                      {staffRoster.map(s => (
                        <button key={s.name} disabled={availLoading} className={`q-btn${selStaff === s.name ? ' sel' : ''}`} aria-pressed={selStaff === s.name} onClick={() => {
                          const next = selStaff === s.name ? '' : s.name
                          setSelStaff(next)
                          setWlDone(false); setWlErr('')
                          if (selDate && selTime) fetchAvailability(selDate, selTime, visibleCourses[selCourse]?.name, next || undefined)
                        }}>
                          {s.name}
                        </button>
                      ))}
                    </div>
                    {selDate && selTime && availLoading && <p className="hint" style={{ marginTop: 8 }}>{staffCheckingText()}</p>}
                    <p className="hint" style={{ marginTop: 8 }}>{lang === 'en' ? `We may not always be able to arrange your requested ${staffLabel}. Thank you for your understanding.` : `ご希望の${staffLabel}をご用意できない場合がございます。あらかじめご了承ください。`}</p>
                  </div>
                </div>
              )}

              {/* 同伴者情報（人数が2名以上の場合、名前・アレルギー等を1人ずつ入力できる。飲食店以外向けに設定でOFFにできる） */}
              {companionInfoEnabled && companionCount() >= 2 && (
                <div className="card">
                  <h3 className="card-lbl card-lbl-optional">{t('ご一緒される方のお名前・ご要望等（任意）')}</h3>
                  <div className="card-body">
                    {companions.slice(0, companionCount()).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < companionCount() - 1 ? 8 : 0 }}>
                        <input type="text" value={c.name} onChange={(e) => updateCompanion(i, 'name', e.target.value)}
                          placeholder={lang === 'en' ? `Guest ${i + 1} name (optional)` : `${i + 1}人目のお名前（任意）`} style={{ flex: '1 1 40%' }} />
                        {/* 以前はプレースホルダーの例示が「アレルギー等」固定で飲食店以外の業態には
                            馴染まなかった（同伴者情報自体は他業態でも使う汎用機能のため、カードラベル
                            側は既に業態を問わない文言になっていたのに、この入力欄だけ飲食店の例示が
                            残っていた）。業態を問わない一般的な文言にする。 */}
                        <input type="text" value={c.allergy} onChange={(e) => updateCompanion(i, 'allergy', e.target.value)}
                          placeholder={lang === 'en' ? `Requests (optional)` : `ご要望（任意）`} style={{ flex: '1 1 60%' }} />
                      </div>
                    ))}
                    <p className="hint" style={{ marginTop: 8 }}>{t('1人目はご予約の代表者様です。お名前を書かなくても「1人目」として記録されます。')}</p>
                  </div>
                </div>
              )}

              {/* ご要望 */}
              <div className="card">
                <h3 className="card-lbl card-lbl-optional">{t('その他のご要望（任意）')}</h3>
                <div className="card-body">
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('上記以外のご要望があればご記入ください')} />
                </div>
              </div>
            </>
          )}

          {inputErr && <div className="err mt12" role="alert" aria-live="polite">{inputErr}</div>}
          <div className="mt16">
            <button className="btn-p" onClick={goConfirm}>{t('確認画面へ　→')}</button>
          </div>
          <div className="mt8">
            <button className="myres-link" onClick={openMyRes}>{t('ご予約の確認・変更はこちら')}</button>
          </div>
        </div>
      )}

      {/* ── CONFIRM ── */}
      {screen === 'confirm' && (
        <div className="scr">
          <div className="card">
            <h2 className="card-lbl">{t('✅　ご予約内容の確認')}</h2>
            {!isSimpleMode && (
              <div className="cf-row">
                <div className="cf-lbl">{itemLabel}</div>
                <div className="cf-val">
                  {visibleCourses[selCourse]?.name || itemLabel}
                  <br />
                  <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--sub)' }}>
                    {/* ||だとprice=0（無料相談枠等）でも貝屋和光の実価格にフォールバックしてしまう同種のバグ */}
                    ¥{(() => { const p = Number(visibleCourses[selCourse]?.price); return Number.isFinite(p) ? p : 11000 })().toLocaleString()}
                    {lang === 'en'
                      ? ` (tax incl.) / ${countUnit === '台' ? 'per unit' : 'per person'}　・　${fmtDuration(visibleCourses[selCourse]?.duration, lang)}`
                      : `（税込）/ ${countUnit === '台' ? `1${countUnit}` : 'お一人様'}　・　${fmtDuration(visibleCourses[selCourse]?.duration, lang)}`}
                  </span>
                </div>
              </div>
            )}
            <div className="cf-row">
              <div className="cf-lbl">{visitText('ご来店日')}</div>
              <div className="cf-val">{fmtDateLang(selDate, lang)}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('時間')}</div>
              <div className="cf-val">{selTime}〜{addMin(selTime, selStayMin, lang)}（{t('目安')}）</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('人数')}</div>
              <div className="cf-val">{selGuest === 'konsult' ? konsultGuestLabel() : effectiveGuests ? guestsWithUnit(effectiveGuests) : t('人数未定')}</div>
            </div>
            {isKasshiki && (
              <div className="cf-row">
                <div className="cf-lbl">{t('プラン')}</div>
                <div className="cf-val acc">
                  {selGuest === 'konsult' ? t('💬 貸切要相談') : t('🔒 貸切プラン')}
                </div>
              </div>
            )}
            <div className="cf-row">
              <div className="cf-lbl">{t('お名前')}</div>
              {/* 英語モードでも{name}の後ろに半角スペースが常に1つ残っていた（'様'を省く条件分岐が
                  文字自体だけを対象にしており、直前の固定スペースが分岐の外にあったため）。
                  見た目上はほぼ気づかれないが、他のi18n分岐が丁寧に扱われている中でこれだけ雑だった
                  （Apple CEO視点レビュー・ラウンド42での指摘）。 */}
              <div className="cf-val">{name}{lang === 'en' ? '' : ' 様'}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('電話番号')}</div>
              <div className="cf-val">{phone}</div>
            </div>
            {q1.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">{(q1Question || 'ご利用目的').replace(/（任意）$/, '')}</div>
                <div className="cf-val">{isQ1Other(q1) ? (q1Other.trim() || q1) : q1.trim()}</div>
              </div>
            )}
            {q3.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">{(q3Question || 'どのように当店を知りましたか').replace(/（任意）$/, '')}</div>
                <div className="cf-val">{isQ3Other(q3) ? (q3Other.trim() || q3) : q3.trim()}</div>
              </div>
            )}
            {staffAssignmentEnabled && selStaff && (
              <div className="cf-row">
                <div className="cf-lbl">{t('ご指名')}</div>
                <div className="cf-val">{selStaff}</div>
              </div>
            )}
            {buildNotesPayload() && (
              <div className="cf-row">
                <div className="cf-lbl">{t('ご要望')}</div>
                <div className="cf-val" style={{ whiteSpace: 'pre-wrap' }}>{buildNotesPayload()}</div>
              </div>
            )}
          </div>
          {/* 定期予約（シリーズ予約）：貸切・大人数相談では選べない（上記state宣言のコメント参照）。
              使わない店舗にも常に見えていた（Apple CEO・Appleデザインチーム視点レビュー・2026-08-11の
              指摘）ため、waitlist等と同じくFEATURE_SETTINGSで丸ごと隠せるようにする。 */}
          {!isKasshiki && !isKonsult && featureFlags.recurringBookingEnabled && (
            <div className="card" style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, fontWeight: 'bold' }}>
                <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
                {t('📅 定期予約として申し込む')}
              </label>
              {isRecurring && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    {[['weekly', t('毎週')], ['biweekly', t('隔週')], ['monthly', t('毎月')], ['custom', t('カスタム')]].map(([v, l]) => (
                      <button key={v} className={`q-btn${recurringFrequency === v ? ' sel' : ''}`} aria-pressed={recurringFrequency === v} onClick={() => setRecurringFrequency(v)} type="button">{l}</button>
                    ))}
                  </div>
                  {/* カスタム間隔（美容院の6〜8週間隔等、毎週/隔週/毎月の3択に収まらない利用パターンが
                      業種経営者陣視点レビュー・2026-08-11で指摘された）。 */}
                  {recurringFrequency === 'custom' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
                      <span>{t('間隔')}：</span>
                      <select value={customIntervalWeeks} onChange={e => setCustomIntervalWeeks(parseInt(e.target.value, 10))} aria-label={t('間隔')} style={{ padding: '6px 10px' }}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <option key={n} value={n}>{n}{t('週間ごと')}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span>{t('回数')}：</span>
                    <select value={recurringCount} onChange={e => setRecurringCount(parseInt(e.target.value, 10))} aria-label={t('回数')} style={{ padding: '6px 10px' }}>
                      {[2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}{t('回')}</option>)}
                    </select>
                  </div>
                  {/* 頻度・回数を選んでも、実際に申し込まれる日付が確認画面のどこにも表示されず、
                      送信するまで具体的な日にちが分からなかった（ランダム客層・イーロン両視点レビュー・
                      ラウンド35の指摘：特に「毎月」は月によって日付がズレる問題と合わせて、事前に
                      確認できないと送信後に初めて意図と違う日程だったと気づくことになる）。 */}
                  <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8, lineHeight: 1.7 }}>
                    {t('申し込まれる日程')}：{buildRecurringDates(selDate, recurringFrequency, recurringCount, customIntervalWeeks).map(d => fmtDateLang(d, lang)).join(lang === 'en' ? ', ' : '、')}
                  </div>
                  {/* 合計金額（目安）：ラウンド42では「countUnitに依存する価格の意味が業態ごとに違う」ため
                      表示を見送っていた。上に表示している単価は「countUnitが台＝1台あたりの単位料金（人数が
                      増えても変わらない）」か「お一人様＝1人あたりの単価」のどちらかだが、後者はこのアプリが
                      人数×単価の掛け算をどこでも行っていない（人数によって実際の会計が変わる飲食店のコース等）。
                      そのため合計を「単価×回数」で出すと、複数名で申し込む飲食店等では実際より少ない金額に
                      見えてしまう危険がある。安全に合計を出せるのは、単価がそもそも人数に左右されない場合
                      （countUnit==='台'＝車両・器材等を1台単位で数える業態）か、人数が常に1に固定されている場合
                      （guestCountEnabledがOFF＝美容院・クリニック・整備工場等、常に1名分の単価＝1回の実費用）
                      に限られる。この2条件のどちらにも当たらない場合（飲食店のように人数を選ばせつつ
                      お一人様単価で課金する業態）は、誤った金額を見せるリスクを避けて表示しない
                      （Apple CEO視点レビュー・第43回：countUnitが独立した入力欄になったことで初めて
                      この条件分岐が安全に書けるようになった）。
                      第43回の実装は上の単価表示行（2260行目付近）と同じ`!isSimpleMode`もこの条件に含めて
                      いたが、これは価格の安全性とは無関係の別条件だった（業種経営者陣視点レビュー・第44回：
                      定期予約を実際に使いたがる学習塾面談プリセットで検証した際に発覚）。学習塾面談・面接・
                      定食業態（simple_dining）等のbookingMode==='simple'業態でも、admin.js側は
                      settings.bookingMode==='simple'時に専用の単価入力欄（defaultCourseName＋price）を出し、
                      保存先はcourse制と同じcourses配列（Code.gs）のため、visibleCourses[selCourse]?.priceは
                      simple業態でも実在する正しい値。`!isSimpleMode`が付いていたのは単に「コース選択カード自体が
                      無いモードなので単価表示行そのものを出さない」という無関係なUI都合を流用していたためで、
                      guestCountEnabledがOFFの学習塾面談・面接（人数が常に1名固定＝合計計算は安全）まで
                      一律で総額を見せられなくなっていた。単価が人数に左右されない条件はcountUnit/guestCountEnabled
                      だけで既に十分なため、isSimpleModeは外す。 */}
                  {/* 英語版だけ「visits」がハードコードされており、学習塾面談・面接等（来店ではなく
                      レッスン/面談）で不自然だった（業種経営者陣視点レビュー・第45回：学習塾面談での
                      定期予約合計表示ウォークスルーで発覚）。この機能はvisitNoun/visitNounEnで業態ごとに
                      出し分けられるほど作り込まれておらず（visitNounEnはどのプリセットからも設定されない
                      未使用フィールド）、上のOccurrences（t('回数')）・「その回だけ個別にご連絡します」
                      （159行目付近）と同じ、既にアプリ全体で定期予約の単位として使っている業態非依存の
                      語に統一する。第45回で選んだ「occurrence(s)」は業態非依存ではあるものの、レンタカー・
                      車修理・学習塾面談等の実際の店主が読むと臨床的・事務的で不自然（業種経営者陣視点
                      レビュー・第46回）。同じ定期予約シリーズ機能内で既に「cancel all upcoming
                      bookings in this series」（lib/i18n.js内、シリーズキャンセル文言）という表現が
                      使われており、シリーズの1回1回は元々「booking」と呼ばれている。新語を発明せず
                      アプリ全体の既存語彙に合わせ、「booking(s)」に統一する（全業態でそのまま自然：
                      レンタカー「8 bookings」、クリニック「8 bookings」、学習塾面談「8 bookings」等）。 */}
                  {(countUnit === '台' || !guestCountEnabled) && Number.isFinite(Number(visibleCourses[selCourse]?.price)) && (
                    <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 4, lineHeight: 1.7 }}>
                      {lang === 'en'
                        ? `Total (approx.): ¥${(Number(visibleCourses[selCourse]?.price) * recurringCount).toLocaleString()} for ${recurringCount} booking${recurringCount === 1 ? '' : 's'}`
                        : `合計（目安）：¥${(Number(visibleCourses[selCourse]?.price) * recurringCount).toLocaleString()}（${recurringCount}回分）`}
                    </div>
                  )}
                  {/* 「来店日」がvisitText()を経由せずt()に直渡しされていたため、visitNounを
                      カスタマイズした業態（クリニックの「来院」、学習塾の「来塾」等——定期予約を
                      実際に使いたがる業種でもある）で日本語表示のままこの1文だけ「来店日」に
                      戻ってしまっていた（他の全箇所は同じ理由でvisitText()を使っている。1728・1752・
                      2213行目付近参照）。業種経営者陣視点レビュー・第43回での指摘。 */}
                  <div style={{ fontSize: 11, color: 'var(--hint)', marginTop: 6 }}>
                    {visitText('選択した来店日を1回目として、以降を自動で申し込みます。満席等で確定できない回があった場合は、その回だけ個別にご連絡します。')}
                  </div>
                </div>
              )}
            </div>
          )}
          {bookingNotes ? (
            <div className="policy" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setShowNotesPopup(true)}>
              <span style={{ fontSize:16 }}>⚠️</span>
              <span>{t('注意事項・キャンセルポリシーを確認する（タップで再表示）')}</span>
            </div>
          ) : null}
          {cfErr && <div className="err mt12" role="alert" aria-live="assertive">{cfErr}</div>}
          {/* 機微な自由記述（クリニックの診療内容等）を含みうる項目もあるため、単なる案内リンクではなく
              明示的なチェックボックスでの同意に変更した（Apple CEO視点レビューでの指摘：APPIの要配慮
              個人情報は通知だけでなく事前の明示的同意が必要）。全業態共通の仕組みとして提供する。 */}
          <label className="mt16" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--sub)', cursor: 'pointer' }}>
            <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              {t('ご入力いただいた情報の取り扱い（')}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color: 'var(--info-text)', textDecoration: 'underline' }}>{t('こちら')}</a>
              {t('）に同意します')}
            </span>
          </label>
          {/* 同意チェック無しで押せない理由が分からないまま「ボタンが灰色」なだけだと迷わせるため、
              理由を明示する（Appleデザインチーム視点レビューでの指摘） */}
          {!privacyConsent && !submitting && (
            <div className="mt8" style={{ fontSize: 12, color: 'var(--warning-text)', textAlign: 'center' }}>{t('上記の同意チェックが必要です')}</div>
          )}
          <div className="mt16">
            <button className="btn-p" disabled={submitting || !privacyConsent} onClick={submitReservation}>
              {submitting ? t('送信中...') : t('予約を確定する')}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('input')}>{t('← 入力画面に戻る')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {screen === 'done' && (
        <div className="scr">
          <div className="done-card">
            {done.pending ? (
              <div className="ld-wrap" style={{ padding: '20px 0' }}>
                <div className="dots">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <p className="ld-txt">{t('送信中です...')}</p>
              </div>
            ) : done.error ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🙇</div>
                <div className="done-ttl" style={{ color: 'var(--red)' }}>{t('申し訳ございません')}</div>
                <div className="done-sub" style={{ lineHeight: 1.8 }}>
                  {t('予約処理中にエラーが発生しました。')}<br />
                  {t('原因を特定し、早急に対応いたします。')}
                </div>
                {/* 変更フロー（backScreen==='chgconfirm'）だけこの電話・LINE案内が出ず、通信エラー時に
                    「変更できたかどうか分からないが、連絡手段も分からない」という詰み画面になっていた
                    （ランダム客層視点レビューでの指摘：新規予約の失敗時は案内が出るのに、変更失敗時は
                    出ない、という条件の書き漏れ）。'confirm'に限定せず、両方で表示する。 */}
                {(done.backScreen === 'confirm' || done.backScreen === 'chgconfirm') && (
                  <div style={{ marginTop: 20, marginBottom: 12, fontSize: 14, color: 'var(--sub)', lineHeight: 1.8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    {t('お手数ですが、お電話（')}<a href={telHref(bizPhone)} style={{ color: 'var(--green)', fontWeight: 'bold' }}>{bizPhone}</a>{t('）または、')}<br />
                    {t('このLINE公式アカウントのトーク画面からご連絡ください。')}
                  </div>
                )}
                <div className="mt16">
                  <button className="btn-s" onClick={() => { setScreen(done.backScreen); setSubmitting(false); setChgSubmitting(false) }}>{t('← 戻る')}</button>
                </div>
              </>
            ) : (
              <>
                <div className="done-ck" style={done.pendingApproval ? { background: '#f5a623' } : undefined}>
                  {done.pendingApproval ? '⏳' : '✓'}
                </div>
                <div className="done-ttl">{done.title}</div>
                {done.pendingApproval && (
                  <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 10, padding: '10px 14px', margin: '0 0 12px', fontSize: 13, color: 'var(--warning-text)', fontWeight: 'bold' }}>
                    {t('※ まだ確定していません。店舗からの確認のご連絡をお待ちください。')}
                  </div>
                )}
                <div className="done-sub" style={{ whiteSpace: 'pre-line' }}>{done.detail}</div>
                <div className="done-id">{done.id}</div>
                <div className="mt16" style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                  <button className="btn-p" onClick={() => {
                    setSelDate(''); setSelTime(''); setSelGuest(''); setSelCourse(0)
                    setIsKasshiki(false); setIsKonsult(false); setShowKasshikiWarning(false)
                    setQ1(''); setQ1Other(''); setQ3(''); setQ3Other(''); setNotes(''); setShowOptional(true)
                    setAvail(null); setAvailErr(''); setInputErr('')
                    // selGuestは''にリセットしていたが、同伴者情報（companions）は人数変更時のuseEffectが
                    // 配列を「切り詰める」だけで内容をクリアしないため、ここで明示的にリセットしないと
                    // 前の予約の同伴者名・アレルギー情報が次の別予約に持ち越されてしまっていた
                    // （ランダム客層視点レビューでの指摘：本人が気づかないまま無関係な予約に古い情報が
                    // 付いてしまう）。
                    setCompanions([{ name:'', allergy:'' }])
                    setScreen('input')
                  }}>{t('別の予約をする')}</button>
                  <button className="btn-s" onClick={openMyRes}>{t('ご予約の確認・変更はこちら')}</button>
                </div>
                <AdBannerSlot adBanner={adBanner} place="done" style={{ marginTop: 20 }} lang={lang} />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MY RESERVATIONS ── */}
      {screen === 'myres' && (
        <div className="scr">
          {myResNeedsPhone ? (
            <div className="card">
              <h2 className="card-lbl">{t('📞　電話番号でご予約を確認')}</h2>
              <div className="card-body">
                <p className="hint" style={{ marginBottom: 10 }}>{t('LINEをご利用でないため、ご予約時にご登録いただいたお名前・電話番号でご予約を検索します。')}</p>
                <input type="text" value={myResNameInput} aria-label={t('お名前')}
                  onChange={(e) => { setMyResNameInput(e.target.value); setMyResErr('') }}
                  placeholder={t('お名前（例：山田 太郎）')}
                  style={{ marginBottom: 10 }} />
                <input type="tel" value={myResPhoneInput} aria-label={t('電話番号')}
                  onChange={(e) => { setMyResPhoneInput(e.target.value); setMyResErr('') }}
                  placeholder={t('電話番号（例：090-0000-0000）')} />
                {myResErr && <div className="err" role="alert" aria-live="polite" style={{ marginTop: 10 }}>{myResErr}</div>}
                <div className="mt16">
                  <button className="btn-p" disabled={myResLoading} onClick={lookupMyResByPhone}>
                    {myResLoading ? t('確認中...') : t('確認する')}
                  </button>
                </div>
              </div>
            </div>
          ) : myResLoading ? (
            <div className="card">
              <div className="card-body" style={{ textAlign: 'center', padding: 30 }}>
                <div className="dots">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--hint)' }}>{t('予約を確認中...')}</p>
              </div>
            </div>
          ) : myResErr ? (
            <div className="no-res" role="alert" aria-live="polite" style={{ color: 'var(--red)' }}>
              {myResErr}<br />
              📞 <a href={telHref(bizPhone)} style={{ color: 'var(--green)', fontWeight: 'bold' }}>{bizPhone}</a>
            </div>
          ) : myRes.length === 0 ? (
            <div className="no-res">{t('現在、確定しているご予約はございません。')}</div>
          ) : (
            myRes.map((res) => (
              <div key={res.id} className="res-card">
                <div className="res-date">{fmtDateLang(res.date, lang)}</div>
                <div className="res-detail">
                  ⏰ {fmtTime(res.time)}〜{fmtTime(res.endTime)}　👥 {guestsDisplay(res.guests)}
                  <br />{itemIcon} {res.course}
                  {/* 確認・変更完了等の通知（LINE・メール）には既に指名担当者の情報が出ているのに、
                      この画面（マイ予約）だけ表示されていなかった（Meta CEO視点レビュー・ラウンド38
                      での指摘）。通知と同じ表記に揃える。 */}
                  {res.requestedStaff ? <><br />🔖 {t('ご指名')}：{res.requestedStaff}{res.additionalStaff && res.additionalStaff.length > 0 ? `（＋${res.additionalStaff.join('、')}）` : ''}</> : null}
                  {res.notes ? <><br />💬 {res.notes}</> : null}
                </div>
                {/* 予約時のLINE・メール通知には「🔒 貸切プラン」表示があるのに、確定後（status==='要確認'
                    でなくなった後）はこのカードから貸切であることを示す手がかりが一切無くなっていた
                    （Meta CEO視点レビュー・ラウンド39での指摘：最低保証額が発生する買い切り予約なのに、
                    確定後は普通の予約と見分けがつかない）。status に関わらず常に表示する。 */}
                {/* isKonsult（13名以上・大人数のご相談）はサーバー側で常にisKasshikiも同時にtrueになる
                    （index.jsのconsultボタンがisKasshiki/isKonsultを同時にON、createReservationも経路列を
                    isKasshikiと書き分けていない）ため、下のisKasshiki分岐と両方same-timeで真になり得る。
                    isKonsultを先に判定して「🔒 貸切プラン」と「💬 貸切要相談」が二重表示されないようにする
                    （Meta CEO視点レビュー・ラウンド41での指摘：貸切と大人数相談は最低保証額の有無等の
                    運用が異なる別プランなので、確定後も見分けられる必要がある）。 */}
                {res.isKonsult ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sub)', fontWeight: 'bold' }}>
                    {/* 予約フロー確認画面（confirm画面、selGuest==='konsult'の分岐）と同じ辞書キーを使う。
                        t()の辞書キーは絵文字を含む'💬 貸切要相談'のため、絵文字をJSX側で分離すると
                        exact-match lookupが失敗し英語ユーザーに生の日本語がそのまま表示される
                        （ラウンド40での同種バグの再発防止）。 */}
                    {t('💬 貸切要相談')}
                  </div>
                ) : res.isKasshiki && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sub)', fontWeight: 'bold' }}>
                    {/* t()の辞書キーは絵文字を含む'🔒 貸切プラン'のため、絵文字をJSX側で分離すると
                        exact-match lookupが失敗し英語ユーザーに生の日本語がそのまま表示されていた
                        （Meta CEO視点レビュー・ラウンド40での指摘）。他の箇所と同じキー形式に統一する。 */}
                    {t('🔒 貸切プラン')}
                  </div>
                )}
                {res.status === '要確認' && (
                  <div style={{ marginTop: 6, background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--warning-text)', fontWeight: 'bold', display: 'inline-block' }}>
                    ⏳ {t('まだ確定していません（貸切・大人数のご相談中）')}
                  </div>
                )}
                {/* 定期予約（シリーズ予約）：同じseriesIdを持つ予約が2件以上ある場合のみ表示。
                    「まとめてキャンセル」ボタンは、そのシリーズの最初の表示回にのみ1つだけ出す
                    （myResは日付順のため、同じseriesIdの最初の出現＝リスト内で一番早い回）。 */}
                {res.seriesId && myRes.filter(x => x.seriesId === res.seriesId).length > 1 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--sub)' }}>
                    {/* 新規予約確定時のLINE・メール通知（sendConfirmToCustomer/sendConfirmEmailToCustomer）には
                        既に「🔁 定期予約（n/total回目）」と何回目かまで出ているのに、このマイ予約画面だけ
                        「🔁 定期予約」とだけ表示して何回目かが分からなかった（Meta CEO視点レビュー・
                        審判団ラウンド44での指摘）。作成時のn/total（seriesIndex/seriesTotal）自体は台帳に
                        保存されないため通知と全く同じ数字は再現できないが、ここではmyRes内（今後の予約・
                        未キャンセルのみ）で同じseriesIdを持つ件数の中での順番を代わりに示す。*/}
                    🔁 {(() => {
                      const seriesMembers = myRes.filter(x => x.seriesId === res.seriesId)
                      const seriesIdx = seriesMembers.findIndex(x => x.id === res.id) + 1
                      const seriesTotal = seriesMembers.length
                      return lang === 'en' ? `Recurring booking (${seriesIdx} of ${seriesTotal})` : `定期予約（${seriesIdx}/${seriesTotal}回目）`
                    })()}
                    {myRes.findIndex(x => x.seriesId === res.seriesId) === myRes.indexOf(res) && res.status !== 'キャンセル' && (
                      <button className="btn-s" style={{ marginLeft: 8, padding: '4px 10px', fontSize: 12 }}
                        disabled={seriesCancelingId === res.seriesId} onClick={() => { setSeriesCancelConfirmId(res.seriesId); setSeriesCancelErr('') }}>
                        {seriesCancelingId === res.seriesId ? t('処理中...') : t('このシリーズをまとめてキャンセル')}
                      </button>
                    )}
                    {seriesCancelConfirmId === res.seriesId && (
                      /* role="alertdialog"はWAI-ARIA仕様上alertロールのサブクラスであり、
                         aria-live="assertive"を暗黙値として既に持つ（役割自体がライブリージョンとして
                         扱われる）。フォーカス移動（はいボタンへ）も併用しているため、明示的な
                         aria-live="assertive"を残すとAT側でメッセージの二重読み上げ（ライブリージョン
                         変化の通知＋フォーカス移動時のダイアログ名読み上げ）が起きるリスクがあった
                         （Appleデザインチーム視点レビュー・ラウンド43-44で保留、ラウンド45で確定）。
                         role="alertdialog"＋aria-labelledby＋フォーカス移動だけで十分なため明示指定は削除。 */
                      <div className="cnl-confirm" style={{ marginTop: 6 }} role="alertdialog" aria-labelledby={`cnl-msg-series-${res.seriesId}`}>
                        <p className="cnl-msg" id={`cnl-msg-series-${res.seriesId}`}>{t('このシリーズの今後の予約をすべてキャンセルします。よろしいですか？')}</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" ref={el => { cnlYesRefs.current[`series-${res.seriesId}`] = el }} disabled={seriesCancelingId === res.seriesId}
                            onClick={() => { setSeriesCancelConfirmId(null); cancelSeriesAll(res.seriesId) }}>
                            {seriesCancelingId === res.seriesId ? t('処理中...') : t('はい')}
                          </button>
                          <button className="cnl-no" disabled={!!seriesCancelingId} onClick={() => setSeriesCancelConfirmId(null)}>{t('いいえ')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {seriesCancelErr && seriesCancelErrId === res.seriesId && <div className="err" role="alert" aria-live="polite" style={{ marginTop: 4 }}>{seriesCancelErr}</div>}
                {/* 見積/承認フロー：予約自体のステータスとは独立（辞退しても予約自体は残る）。
                    「提示済み」の間だけ承諾・辞退の操作を出す。 */}
                {res.estimateStatus === '提示済み' && (
                  <div style={{ marginTop: 8, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>💰 {t('お見積り')}：¥{(parseFloat(res.estimateAmount) || 0).toLocaleString()}</div>
                    {/* 部品代・工賃の内訳（車修理工場向け、業種経営者陣視点レビュー・2026-08-13の指摘で新設）。
                        両方揃っている時だけ表示する（片方だけでは内訳として意味をなさないため）。 */}
                    {res.estimatePartsAmount && res.estimateLaborAmount && (
                      <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 4 }}>
                        {t('部品代')}：¥{(parseFloat(res.estimatePartsAmount) || 0).toLocaleString()}　{t('工賃')}：¥{(parseFloat(res.estimateLaborAmount) || 0).toLocaleString()}
                      </div>
                    )}
                    {res.estimateNote && <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 8 }}>{res.estimateNote}</div>}
                    {/* 辞退＝予約自体のキャンセルだと誤解されるリスクがテスト全部隊レビュー・2026-08-11で
                        複数視点から指摘された。承諾・辞退どちらでも予約自体は変わらない旨を明記する。
                        estimateFlowは既定でrepair（車修理工場）向けだが、fset側で他業態も個別にONにできる
                        機能のため、visitNoun（来院・来館等）をカスタマイズした業態がONにすると「ご来店予約」
                        という文言だけ取り残される（業種経営者陣視点レビュー・第44回：clinicプリセットの
                        フルウォークスルーで発覚）。他の日時ラベルと同じくvisitText()経由にする。 */}
                    <div style={{ fontSize: 11, color: 'var(--hint)', marginBottom: 8 }}>{visitText('※ 承諾・辞退いずれの場合も、ご来店予約自体はキャンセルになりません。')}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-p" style={{ padding: '9px 14px', fontSize: 13 }} disabled={estimateRespondingId === res.id} onClick={() => setEstimateConfirm({ id: res.id, accept: true })}>
                        {estimateRespondingId === res.id ? t('送信中...') : t('承諾する')}
                      </button>
                      <button className="btn-s" style={{ padding: '9px 14px', fontSize: 13 }} disabled={estimateRespondingId === res.id} onClick={() => setEstimateConfirm({ id: res.id, accept: false })}>
                        {t('辞退する')}
                      </button>
                    </div>
                    {estimateConfirm?.id === res.id && (
                      /* 上のシリーズキャンセル確認と同じ理由でaria-live明示指定は削除（ラウンド45）。 */
                      <div className="cnl-confirm" style={{ marginTop: 8 }} role="alertdialog" aria-labelledby={`cnl-msg-estimate-${res.id}`}>
                        <p className="cnl-msg" id={`cnl-msg-estimate-${res.id}`}>{estimateConfirm.accept ? t('この見積を承諾します。よろしいですか？') : visitText('この見積を辞退します。よろしいですか？（ご来店予約自体は継続します）')}</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" ref={el => { cnlYesRefs.current[`estimate-${res.id}`] = el }} disabled={estimateRespondingId === res.id}
                            onClick={() => { const c = estimateConfirm; setEstimateConfirm(null); respondEstimate(c.id, c.accept) }}>
                            {estimateRespondingId === res.id ? t('送信中...') : t('はい')}
                          </button>
                          <button className="cnl-no" disabled={!!estimateRespondingId} onClick={() => setEstimateConfirm(null)}>{t('いいえ')}</button>
                        </div>
                      </div>
                    )}
                    {estimateRespondErr && estimateRespondErrId === res.id && <div className="err" role="alert" aria-live="polite" style={{ marginTop: 6 }}>{estimateRespondErr}</div>}
                  </div>
                )}
                {(res.estimateStatus === '承諾済み' || res.estimateStatus === '辞退済み') && (
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--sub)' }}>
                    💰 {t('お見積り')}：¥{(parseFloat(res.estimateAmount) || 0).toLocaleString()}　{res.estimateStatus === '承諾済み' ? `✅ ${t('承諾済み')}` : `— ${t('辞退済み')}`}
                    {/* 「提示済み」「完了」の両カードには既にある部品代・工賃の内訳・メモが、承諾／辞退直後の
                        この状態だけ欠けていた（Meta CEO視点レビュー・ラウンド43での指摘：見積送信時の
                        LINE/メール通知にはメモ・内訳が載っているのに、画面側は承諾・辞退した直後の画面だけ
                        総額のみに縮退し、「完了」に進むまでメモ・内訳を見返す手段が無かった）。 */}
                    {res.estimatePartsAmount && res.estimateLaborAmount && (
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        {t('部品代')}：¥{(parseFloat(res.estimatePartsAmount) || 0).toLocaleString()}　{t('工賃')}：¥{(parseFloat(res.estimateLaborAmount) || 0).toLocaleString()}
                      </div>
                    )}
                    {res.estimateNote && <div style={{ fontSize: 12, marginTop: 2 }}>{res.estimateNote}</div>}
                  </div>
                )}
                {/* 承諾済みの見積の作業が完了した状態（業種経営者陣視点レビュー・2026-08-13で新設）。
                    他のステータスより目立たせる（引き取りに来ていただく必要がある実際の行動を要するため）。
                    以前は緑枠を使っていたが、このサイトで緑は「選択中・実行可能」を示す色として
                    多用されているため、受動的な状態通知と誤読されうる（Apple CEO・Appleデザイン
                    チーム両視点レビュー・2026-08-13の指摘）。他の色と衝突しない青系（--info-*）に変更。
                    また承諾していた見積金額がこの状態になると画面から消えてしまっていた（Meta CEO視点
                    レビューでの指摘）ため、金額もここに残す。 */}
                {res.estimateStatus === '完了' && (
                  <div style={{ marginTop: 8, background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 'bold', color: 'var(--info-text)' }}>
                    {/* estimateWorkDoneMessageはサーバー側（getMyReservations）で配信設定のカスタム文言を
                        解決済みで返してくる。店舗が既定文言のままなら翻訳辞書のt()で多言語対応し、
                        カスタマイズ済みならそのまま表示する（店舗が自由に書いた文章を翻訳する手段は無いため。
                        PMO視点レビュー・審判団ラウンド34での指摘：以前はLINE/メール通知だけがカスタム文言に
                        対応し、この画面だけ常にハードコードの既定文言が出ていた）。 */}
                    🔧 {res.estimateWorkDoneMessage === 'ご依頼の作業が完了しました。ご都合の良い時にお引き取りにお越しください。'
                      ? t(res.estimateWorkDoneMessage)
                      : (res.estimateWorkDoneMessage || t('ご依頼の作業が完了しました。ご都合の良い時にお引き取りにお越しください。'))}
                    <div style={{ fontWeight: 'normal', marginTop: 4 }}>💰 {t('お見積り')}：¥{(parseFloat(res.estimateAmount) || 0).toLocaleString()}</div>
                    {/* 「提示済み」カードには既にある部品代・工賃の内訳が、この「完了」カードだけ
                        欠けていた（Meta CEO視点レビュー・ラウンド38での指摘：LINE/メール通知の作業完了
                        案内には既に内訳が再掲されているのに、画面側だけ総額のみだった）。 */}
                    {res.estimatePartsAmount && res.estimateLaborAmount && (
                      <div style={{ fontWeight: 'normal', fontSize: 12, marginTop: 2 }}>
                        {t('部品代')}：¥{(parseFloat(res.estimatePartsAmount) || 0).toLocaleString()}　{t('工賃')}：¥{(parseFloat(res.estimateLaborAmount) || 0).toLocaleString()}
                      </div>
                    )}
                    {/* 内訳と同じ理由（ラウンド43での指摘）：メモも「提示済み」カードにしかなく、「完了」まで
                        進むと見返す手段が無かった。 */}
                    {res.estimateNote && <div style={{ fontWeight: 'normal', fontSize: 12, marginTop: 2 }}>{res.estimateNote}</div>}
                  </div>
                )}
                {res.status === 'キャンセル' ? (
                  <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 13, fontWeight: 'bold' }}>{t('✕ キャンセル済み')}</div>
                ) : !isChangeCancelable(res.date) ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--hint)', lineHeight: 1.7 }}>
                    {t('※ 変更・キャンセルの受付期限が過ぎています。')}<br />
                    {t('直前の変更は基本承っておりませんが、対応できる場合もございます。')}
                    {!featureFlags.lateRequestEnabled ? null : lateReqDoneIds.has(res.id) ? (
                      <div style={{ marginTop: 8, color: 'var(--green)', fontWeight: 'bold' }}>✅ {t('依頼を送信しました。お店からのご連絡をお待ちください。')}</div>
                    ) : lateReqId === res.id ? (
                      <div style={{ marginTop: 8, background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <button className={`q-btn${lateReqType === 'change' ? ' sel' : ''}`} aria-pressed={lateReqType === 'change'} onClick={() => setLateReqType('change')}>{t('変更したい')}</button>
                          <button className={`q-btn${lateReqType === 'cancel' ? ' sel' : ''}`} aria-pressed={lateReqType === 'cancel'} onClick={() => setLateReqType('cancel')}>{t('キャンセルしたい')}</button>
                        </div>
                        <textarea rows={2} value={lateReqMsg} onChange={e => setLateReqMsg(e.target.value)}
                          placeholder={visitText('ご希望の内容（例：来店時間を19時に変更したい）')} />
                        {lateReqErr && <div className="err" role="alert" aria-live="polite" style={{ marginTop: 6 }}>{lateReqErr}</div>}
                        {/* この依頼文（自由記述）も新たに収集する個人情報のため、予約確定と同じ同意チェックを
                            必須にする（Apple CEO視点レビューでの指摘） */}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginTop:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warning-text)', marginTop:4 }}>{t('上記の同意チェックが必要です')}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="btn-p" style={{ padding: '9px 14px', fontSize: 13 }} disabled={lateReqSubmitting || !privacyConsent} onClick={() => submitLateRequest(res)}>
                            {lateReqSubmitting ? t('送信中...') : t('依頼を送信する')}
                          </button>
                          <button className="btn-s" style={{ padding: '9px 14px', fontSize: 13 }} onClick={() => { setLateReqId(null); setLateReqErr('') }}>{t('やめる')}</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        <button className="myres-link" onClick={() => { setLateReqId(res.id); setLateReqType('change'); setLateReqMsg(''); setLateReqErr('') }}>
                          {t('変更・キャンセルを依頼する')}
                        </button>
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {t('お急ぎの場合はお電話ください')}　📞 <a href={telHref(bizPhone)} style={{ color: 'var(--green)', fontWeight: 'bold' }}>{bizPhone}</a>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="res-actions">
                      <button className="btn-chg" onClick={() => openChangeForm(res)}>{t('日程・時間を変更')}</button>
                      <button className="btn-cnl" onClick={() => { setCancelId(res.id); setCancelErr('') }}>{t('キャンセル')}</button>
                    </div>
                    {cancelId === res.id && (
                      /* 上のシリーズキャンセル確認と同じ理由でaria-live明示指定は削除（ラウンド45）。 */
                      <div className="cnl-confirm" role="alertdialog" aria-labelledby={`cnl-msg-cancel-${res.id}`}>
                        <p className="cnl-msg" id={`cnl-msg-cancel-${res.id}`}>{t('本当にキャンセルしますか？')}</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" ref={el => { cnlYesRefs.current[`cancel-${res.id}`] = el }} disabled={cancelingId === res.id} onClick={() => execCancel(res.id)}>
                            {cancelingId === res.id ? t('処理中...') : t('はい')}
                          </button>
                          <button className="cnl-no" disabled={!!cancelingId} onClick={() => { setCancelId(null); setCancelErr('') }}>{t('いいえ')}</button>
                        </div>
                        {cancelErr && (
                          <p className="cnl-msg" style={{ color: 'var(--red)', marginTop: 8 }}>
                            {cancelErr}<br />
                            📞 <a href={telHref(bizPhone)} style={{ color: 'var(--green)', fontWeight: 'bold' }}>{bizPhone}</a>
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
          {/* キャンセル待ち登録の一覧（マイ予約と対になる画面、Meta CEO視点レビュー・審判団ラウンド46で新設）。
              電話番号入力待ち・読み込み中・エラー中は出さず、マイ予約本体の表示が確定した後にだけ出す。 */}
          {!myResNeedsPhone && !myResLoading && !myResErr && myWaitlist.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: 14, color: 'var(--sub)', marginBottom: 8 }}>{t('🕒 キャンセル待ち登録中')}</h3>
              {myWaitlist.map((wl) => (
                <div key={wl.id} className="res-card">
                  <div className="res-date">{fmtDateLang(wl.date, lang)}</div>
                  <div className="res-detail">
                    {wl.time ? `⏰ ${fmtTime(wl.time)}　` : ''}{wl.guests ? `👥 ${guestsDisplay(wl.guests)}` : ''}
                    {wl.staff ? <><br />🔖 {t('ご指名')}：{wl.staff}</> : null}
                  </div>
                  <div className="res-actions">
                    <button className="btn-cnl" onClick={() => { setWlCancelConfirmId(wl.id); setWlCancelErr('') }}>{t('取り消す')}</button>
                  </div>
                  {wlCancelConfirmId === wl.id && (
                    <div className="cnl-confirm" role="alertdialog" aria-labelledby={`wl-msg-cancel-${wl.id}`}>
                      <p className="cnl-msg" id={`wl-msg-cancel-${wl.id}`}>{t('このキャンセル待ち登録を取り消しますか？')}</p>
                      <div className="cnl-btns">
                        <button className="cnl-yes" disabled={wlCancelingId === wl.id} onClick={() => execWaitlistCancel(wl.id)}>
                          {wlCancelingId === wl.id ? t('処理中...') : t('はい')}
                        </button>
                        <button className="cnl-no" disabled={!!wlCancelingId} onClick={() => { setWlCancelConfirmId(null); setWlCancelErr('') }}>{t('いいえ')}</button>
                      </div>
                      {wlCancelErr && (
                        <p className="cnl-msg" style={{ color: 'var(--red)', marginTop: 8 }}>
                          {wlCancelErr}<br />
                          📞 <a href={telHref(bizPhone)} style={{ color: 'var(--green)', fontWeight: 'bold' }}>{bizPhone}</a>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <AdBannerSlot adBanner={adBanner} place="myres" style={{ marginTop: 12, marginBottom: 4 }} lang={lang} />
          <div className="mt8">
            <button className="btn-s" onClick={() => { setAvail(null); setAvailErr(''); setScreen('input') }}>{t('← 戻る')}</button>
          </div>
        </div>
      )}

      {/* ── CHANGE FORM ── */}
      {screen === 'change' && (
        <div className="scr">
          {/* 新規予約フローの下書き復元案内（bookingDraftRestored）と同じ理由・同じ見た目。 */}
          {changeDraftRestored && (
            <div role="status" aria-live="polite" style={{ background:'var(--info-bg)', border:'1px solid var(--info-border)', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:13, color:'var(--info-text)' }}>
              {t('前回入力いただいた内容を復元しました。内容をご確認のうえ、続きをご入力ください')}
            </div>
          )}
          <div className="card">
            <h2 className="card-lbl">{t('📝　変更対象の予約')}</h2>
            <div className="card-body">
              <div className="chg-current">
                <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 6 }}>{fmtDateLang(changingRes?.date, lang)}</div>
                <div>⏰ {fmtTime(changingRes?.time)}〜{fmtTime(changingRes?.endTime)}</div>
                <div>👥 {guestsDisplay(changingRes?.guests)}</div>
                {changingRes?.course && <div style={{ marginTop: 4 }}>{itemIcon} {changingRes.course}</div>}
                {changingRes?.notes && <div style={{ marginTop: 4, color: 'var(--sub)' }}>💬 {changingRes.notes}</div>}
              </div>
            </div>
          </div>
          {chgErr && <div className="err mt12" role="alert" aria-live="polite">{chgErr}</div>}
          <div className="card" id="card-chg-date">
            <h2 className="card-lbl">{visitText('📅　新しいご来店日')}</h2>
            <div className="card-body">
              <CustomerCalendar
                year={calYear} month={calMonth}
                monthAvail={monthAvail}
                dateMin={dateMin} dateMax={dateMax}
                selected={chgDate}
                onSelect={(d) => onChgDateChange(chgDate === d ? '' : d)}
                onPrev={() => { if (calMonth === 0) { setCalYear(y=>y-1); setCalMonth(11) } else setCalMonth(m=>m-1) }}
                onNext={() => { if (calMonth === 11) { setCalYear(y=>y+1); setCalMonth(0) } else setCalMonth(m=>m+1) }}
                loading={monthAvailLoading}
                lang={lang}
              />
            </div>
          </div>
          {chgDate && (
            <div className="card" id="card-chg-time">
              <h2 className="card-lbl">{visitText('⏰　新しい来店時間')}</h2>
              <div className="card-body" style={{ position: 'relative' }}>
                {availLoading && (
                  <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1 }}>
                    <span style={{ fontSize:13, color:'var(--hint)' }}>{capacityModel === 'perStaff' ? staffCheckingText() : t('空き状況を確認中...')}</span>
                  </div>
                )}
                {/* 新規予約フロー（card-time、1324行目付近）には既にある「この日は時間帯がありません」の
                    分岐が、変更フローのこの時間カードだけ漏れていた（ランダム客層視点レビューでの指摘：
                    コースの提供区分（ランチ限定等）によって0件になる日は普通にあり得るのに、ここだけ
                    ボタンが一つも出ない空欄のまま、原因の説明も無く詰みになっていた）。 */}
                {chgTimeSlots.length === 0 ? (
                  <p className="hint">{t('この日はご案内できる時間帯がありません。別の日をお選びください。')}</p>
                ) : (
                  <TimeGrid value={chgTime} onChange={(s) => { setChgTime(s); setChgErr(''); setWlDone(false); setWlErr(''); if (chgDate) fetchAvailability(chgDate, s, changingRes?.course) }} slots={chgTimeSlots} />
                )}
              </div>
            </div>
          )}
          {/* 新規予約フロー（showGuestCard、445行目付近）は selDate && selTime が揃うまで人数カードを
              表示しない。これは、時間帯によって残席が変わる容量モデル（timeSlot・perStaff）では、
              時間未選択（time=undefined）で取得したavailが「その日の合計」を見ているだけで、
              選んだ時間枠の実際の残席数ではないため。変更フローはこのガードが漏れてchgDateだけで
              人数カード（＝満席時のキャンセル待ち案内・貸切満席案内も含む）を出してしまい、時間帯別に
              空きがある日でも、時間未選択時点の日次集計だけで誤って「満席」と案内してしまう場合があった
              （ランダム客層視点レビューでの指摘：新規予約フローには時間選択後というガードが実装済みなのに
              変更フローに実装漏れがあった、繰り返しのパターン）。 */}
          {chgDate && chgTime && guestCountEnabled && (
            <div className="card" id="card-chg-guest">
              <h2 className="card-lbl">{t('👥　人数')}</h2>
              <div className="card-body" style={{ position: 'relative' }}>
                {availLoading && (
                  <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1 }}>
                    <span style={{ fontSize:13, color:'var(--hint)' }}>{capacityModel === 'perStaff' ? staffCheckingText() : t('空き状況を確認中...')}</span>
                  </div>
                )}
                {/* 新規予約フロー（card-guest、1753行目付近）には既にある残席確認失敗時のエラー表示＋
                    再試行ボタンが、変更フローのこの人数カードだけ丸ごと欠落していた（Meta CEO視点
                    レビュー・ラウンド43での指摘：availErrはchgGuestDisabled/guestDisabled両方から
                    参照される共有stateで、セットされると両フローで人数ボタンが全て無効化されるのに、
                    変更フロー側だけ理由も再試行手段も一切案内されず詰みになっていた）。 */}
                {availErr && !availLoading && (
                  <div role="alert" aria-live="polite" style={{ background:'var(--danger-bg)', border:'1px solid var(--danger-border)', borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:13, color:'var(--red)' }}>
                    {availErr}
                    <button onClick={() => fetchAvailability(chgDate, chgTime, changingRes?.course)}
                      style={{ marginLeft:8, background:'var(--white)', border:'1px solid var(--red)', color:'var(--red)', borderRadius:6, padding:'12px 16px', minHeight:44, minWidth:44, fontSize:13, fontWeight:'bold', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                      {t('再試行')}
                    </button>
                  </div>
                )}
                <div className="g-row">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((n) => {
                    const disabled = chgGuestDisabled(n)
                    return (
                      <button key={n}
                        className={`g-btn${chgGuests === String(n) ? ' sel' : ''}${disabled ? ' dis' : ''}`}
                        disabled={disabled}
                        aria-pressed={chgGuests === String(n)}
                        onClick={() => { if (!disabled) { setChgGuests(String(n)); setChgErr(''); setWlDone(false); setWlErr('') } }}>
                        {/* 単位が「名」固定でcountUnit設定（台・件等）を反映していなかった（残席表示・
                            単価表示は既にcountUnitを使っているのに、この人数選択ボタンだけ取り残されて
                            いた）。英語表記は、店舗が単位をカスタマイズしていない大多数の店舗ではこれまで
                            通り自然な"guest(s)"のまま、カスタマイズされている場合は他の箇所（1013・1474行目
                            付近）と同じくcountUnitの値をそのまま添える形にする（審判団バックログ一括
                            レビューでの指摘）。 */}
                        {/* この人数ボタンはcountUnit（資産側の数え方）ではなく、乗る／使う人の頭数を
                            表すguestUnitを使う（perStaffの車両・器材等ではcountUnitと別概念のため。
                            1244行目付近のguestUnit定義コメント参照、業種経営者陣視点レビュー・第43回）。 */}
                        <span className="g-btn-main">{lang === 'en'
                          ? (guestUnit === '名' ? `${n} guest${n === 1 ? '' : 's'}` : `${n} ${guestUnit}`)
                          : `${n}${guestUnit}`}</span>
                        {/* 1名だけは「満席」ではなく「条件あり」（1名利用は相席時のみ受付、というポリシー上の
                            制限であって、実際に満席とは限らない）。新規予約フロー（1390行目付近）には
                            既にこの分岐があるが、変更フローのボタンだけ漏れていた（ランダム客層視点
                            レビューでの指摘：常連客が1名に変更しようとして「満席」と表示され、実際には
                            空いているのに諭められてしまう）。 */}
                        {disabled && <span className="g-btn-sub">{n === 1 ? t('条件あり') : t('満席')}</span>}
                      </button>
                    )
                  })}
                </div>

                {/* 満席日・貸切で埋まっている日：新規予約フロー（1423行目・1501行目付近）には既にある
                    「キャンセル待ち登録」「貸切で埋まっている旨の案内＋電話番号」の案内が、変更フローの
                    この人数カードだけ丸ごと欠落していた（ランダム客層視点レビューでの指摘：常連客が
                    人気日への変更を試み、ボタンが「満席」表示のまま次の行動が一切案内されず詰みになる）。
                    新規予約フローと同じUI・同じjoinWaitlistを使うが、対象日・人数は変更フロー側の
                    chgDate/effectiveChgGuestsを渡す。 */}
                {featureFlags.waitlistEnabled && avail && !availLoading && !avail.hasKasshiki && avail.remainingSeats === 0 && (
                  <div style={{ background:'var(--warning-bg)', border:'1px solid var(--warning-border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>{t('この日は満席です。キャンセルが出た際にお知らせすることができます（先着順のためご案内をお約束するものではありません）。')}</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')} aria-label={t('お名前')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')} aria-label={t('電話番号')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                        </div>
                        {/* 新規予約フローの同種カード（上部）には既にある通知条件の選択が、変更フロー側のこの
                            カードだけ欠落していた（ランダム客層視点レビュー・ラウンド37での指摘）。 */}
                        {capacityModel !== 'daily' && (
                          <div style={{ marginBottom:8, fontSize:12, color:'var(--sub)' }}>
                            <div style={{ marginBottom:4 }}>{t('どのように通知しますか？')}</div>
                            <label style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2, cursor:'pointer' }}>
                              <input type="radio" checked={wlNotifyCondition === 'strict'} onChange={() => setWlNotifyCondition('strict')} />
                              <span>{waitlistStrictLabel()}</span>
                            </label>
                            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                              <input type="radio" checked={wlNotifyCondition === 'anyTime'} onChange={() => setWlNotifyCondition('anyTime')} />
                              <span>{t('同じ日ならいつでも良いので、空きが出たら通知する')}</span>
                            </label>
                          </div>
                        )}
                        {wlErr && <div role="alert" aria-live="polite" style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warning-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          <button onClick={() => joinWaitlist(chgDate, effectiveChgGuests, chgTime)} disabled={wlSubmitting || !privacyConsent}
                            style={{ background:'#ff9800', color:'#fff', border:'none', borderRadius:6, padding:'9px 16px', fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                            {wlSubmitting ? t('登録中...') : t('キャンセル待ちに登録する')}
                          </button>
                          {wlErr && <a href={telHref(bizPhone)} style={{ color:'var(--green)', fontWeight:'bold' }}>📞 {bizPhone}</a>}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {featureFlags.kasshikiEnabled && avail && !availLoading && avail.hasKasshiki && (
                  <div style={{ background:'var(--input-bg)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {featureFlags.waitlistEnabled && wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>
                          {t('この日は貸切のご予約が入っているため、貸切・大人数でのご利用はできません。')}
                          {featureFlags.waitlistEnabled
                            ? t('キャンセルが出た際にお知らせすることもできます（先着順のためご案内をお約束するものではありません）。お急ぎの場合はお電話でご相談ください。')
                            : t('お急ぎの場合はお電話でご相談ください。')}
                        </div>
                        {featureFlags.waitlistEnabled && (
                          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')} aria-label={t('お名前')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')} aria-label={t('電話番号')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                          </div>
                        )}
                        {wlErr && <div role="alert" aria-live="polite" style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {featureFlags.waitlistEnabled && (
                          <>
                            <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                              <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                            </label>
                            {!privacyConsent && (
                              <div style={{ fontSize:11, color:'var(--warning-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                            )}
                          </>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          {featureFlags.waitlistEnabled && (
                            <button onClick={() => joinWaitlist(chgDate, effectiveChgGuests, chgTime, true)} disabled={wlSubmitting || !privacyConsent}
                              style={{ background:'#ff9800', color:'#fff', border:'none', borderRadius:6, padding:'9px 16px', fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                              {wlSubmitting ? t('登録中...') : t('キャンセル待ちに登録する')}
                            </button>
                          )}
                          <a href={telHref(bizPhone)} style={{ color:'var(--green)', fontWeight:'bold' }}>📞 {bizPhone}</a>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="card">
            <h3 className="card-lbl">{t('💬　伝言・要望（任意）')}</h3>
            <div className="card-body">
              <textarea rows={3} value={chgMsg} onChange={(e) => setChgMsg(e.target.value)}
                placeholder={t('変更に際してのご要望や伝言があればご記入ください')} />
            </div>
          </div>
          <div className="mt16">
            <button className="btn-p" disabled={chgResGone} onClick={() => {
              // 下書き復元直後のgetMyReservations裏取り（restoreChangeDraftIfAny、1320行目付近）で
              // 対象の予約が既に見つからない／キャンセル済みだと判明した場合。ボタン自体はdisabledで
              // 塞いでいるが、裏取りの応答が遅れてボタンが押されてからtrueになる一瞬のレースもあり
              // うるため、ここでも同じ理由で二重にガードする（Google CEO視点レビュー・ラウンド46）。
              if (chgResGone) return
              if (!chgDate) { setChgErr(visitText('新しいご来店日を選択してください')); return scrollToCard('card-chg-date') }
              if (deadlinePassed(chgDate)) { setChgErr(t('選択された日付は予約受付期限を過ぎています')); return scrollToCard('card-chg-date') }
              if (!chgTime) { setChgErr(visitText('新しい来店時間を選択してください')); return scrollToCard('card-chg-time') }
              if (guestCountEnabled && !chgGuests) { setChgErr(t('人数を選択してください')); return scrollToCard('card-chg-guest') }
              // 復元直後にお客様が即座にタップした場合、残席の再確認（restoreChangeDraftIfAny内の
              // fetchAvailability）がまだ終わっていない可能性があり、goConfirm（1300行目付近）で
              // 直した理由と全く同じレースコンディションがここにもある（ランダム客層視点レビュー・
              // ラウンド45での指摘）。
              if (availLoading) { setChgErr(t('空き状況を確認中です。少し待ってからもう一度お試しください')); return }
              // 上のavailLoadingガードは「読み込み中」のみを塞ぎ、再取得が失敗した場合（avail===null
              // かつavailErr有り）は素通りしていた。新規予約フロー側のgoConfirm（1380行目付近）で
              // 同じ抜け穴を塞いだのと全く同じ理由で、変更フローにも個別に追加する（ランダム客層視点
              // レビュー・ラウンド46での指摘：新規予約フローで直した教訓が変更フローへ横展開されて
              // いなかった、これまでも繰り返し起きているパターンの再発）。人数カード自体は
              // guestCountEnabledがfalseの店舗（人数を扱わない業態）では表示されないため、その場合は
              // このチェック対象外でよい。
              if (guestCountEnabled && !avail && availErr) { setChgErr(availErr); return scrollToCard('card-chg-guest') }
              // avail取得済みでも、下書き復元前から選択済みだった人数が、取り直した最新の残席状況では
              // 既にご案内できなくなっている場合がある（chgGuestDisabledは人数ボタンの表示のみを
              // 制御しており、既に選択済みの値そのものは自動では外れない）。
              if (guestCountEnabled && chgGuestDisabled(parseInt(chgGuests) || 0)) {
                setChgErr(t('選択した人数ではご案内できません。空き状況をご確認のうえ、もう一度お試しください'))
                return scrollToCard('card-chg-guest')
              }
              setChgErr('')
              setScreen('chgconfirm')
            }}>{t('確認へ')}</button>
            <div className="mt8">
              {/* 「← 戻る」でマイ予約に戻るのは、この変更を一旦保留する意図的な操作。ここで下書きを
                  消しておかないと、この後WebViewが破棄される／LIFFを開き直す等でページが再読み込み
                  されるとrestoreChangeDraftIfAny（1213行目付近）が必ず走り、「マイ予約を見るだけ」の
                  つもりが次に開いた時にまた同じ変更フォームへ古い内容ごと連れ戻されてしまう
                  （openMyRes、1426行目付近と同じ理由・ランダム客層視点レビュー・ラウンド45での指摘）。 */}
              <button className="btn-s" onClick={() => { setAvail(null); setAvailErr(''); clearChangeDraft(); setScreen('myres') }}>{t('← 戻る')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE CONFIRM ── */}
      {screen === 'chgconfirm' && (
        <div className="scr">
          <div className="card">
            <h2 className="card-lbl">{t('🔄　変更内容の確認')}</h2>
            <div className="cf-row">
              <div className="cf-lbl">{t('変更前')}</div>
              <div className="cf-val" style={{ color: 'var(--sub)' }}>
                {fmtDateLang(changingRes?.date, lang)}<br />{fmtTime(changingRes?.time)}〜{fmtTime(changingRes?.endTime)}　{guestsDisplay(changingRes?.guests)}
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('変更後')}</div>
              <div className="cf-val acc">
                {fmtDateLang(chgDate, lang)}　{chgTime}〜{addMin(chgTime, chgStayMin, lang)}　{guestsWithUnit(effectiveChgGuests)}
              </div>
            </div>
            {chgMsg.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">{t('伝言')}</div>
                <div className="cf-val">{chgMsg.trim()}</div>
              </div>
            )}
          </div>
          <div className="policy">
            ⚠️ {deadlineLabel(chgDate) || t('変更後の予約日が受付期限を過ぎている場合はキャンセル料が発生することがあります。')}
          </div>
          {chgcfErr && <div className="err mt12" role="alert" aria-live="assertive">{chgcfErr}</div>}
          {/* 新規予約確認画面（1871行目付近）・期限後変更依頼（2037行目付近）には既にある明示的な同意
              チェックボックスが、性質が同じ「伝言・要望（自由記述）」を送信するこの変更確定画面にだけ
              存在しなかった（Apple CEO・ランダム客層の両視点が独立発見・ラウンド30での指摘）。 */}
          <label className="mt16" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--sub)', cursor: 'pointer' }}>
            <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              {t('ご入力いただいた情報の取り扱い（')}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color: 'var(--info-text)', textDecoration: 'underline' }}>{t('こちら')}</a>
              {t('）に同意します')}
            </span>
          </label>
          {!privacyConsent && !chgSubmitting && (
            <div className="mt8" style={{ fontSize: 12, color: 'var(--warning-text)', textAlign: 'center' }}>{t('上記の同意チェックが必要です')}</div>
          )}
          <div className="mt16">
            <button className="btn-p" disabled={chgSubmitting || !privacyConsent || chgResGone} onClick={submitChange}>
              {chgSubmitting ? t('送信中...') : t('変更を確定する')}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('change')}>{t('← 戻る')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTES POPUP ── */}
      {showNotesPopup && (
        <div role="dialog" aria-modal="true" aria-labelledby="notes-popup-title" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:500, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
          <div style={{ background:'var(--white)', borderRadius:'16px 16px 0 0', padding:'24px 20px 36px', width:'100%', maxWidth:480, maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <h2 id="notes-popup-title" style={{ fontSize:16, fontWeight:'bold', color:'var(--text)' }}>{t('⚠️ ご予約にあたっての注意事項')}</h2>
              {/* アイコンのみの閉じるボタンが、他の同種アイコンボタン（再試行ボタン等、1897・2925行目付近）
                  には既にあるminHeight/minWidth:44（タッチターゲットサイズ）を持たず、実際のクリック
                  可能領域がフォントサイズ22px相当（見た目の✕とほぼ同じ）しか無かった
                  （Appleデザインチーム視点レビュー・ラウンド45での指摘）。他のアイコンボタンと同じ
                  44×44の最小タッチターゲットに揃える。 */}
              <button onClick={() => setShowNotesPopup(false)} aria-label={t('閉じる')}
                style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--hint)', minWidth:44, minHeight:44, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            <div style={{ fontSize:13, color:'var(--sub)', lineHeight:1.9, whiteSpace:'pre-line', marginBottom:24 }}>
              {bookingNotes}
            </div>
            <button
              onClick={() => { setShowNotesPopup(false); setScreen('confirm') }}
              style={{ display:'block', width:'100%', padding:16, background:'var(--green)', color:'#fff', border:'none', borderRadius:12, fontSize:16, fontWeight:'bold', cursor:'pointer' }}>
              {t('確認しました　→')}
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        :root {
          --green: #06c755;
          --bg: #f0f0f0;
          --white: #fff;
          --text: #111;
          --sub: #666;
          --hint: #aaa;
          --border: #ddd;
          --red: #e53935;
          /* 管理画面（admin.js）と同じ意味（見積完了の告知・LINEなしでのご予約案内等）で使うトークンなのに
             値が異なっていた（客画面は薄い青、管理画面はMaterial系の明るい青）。管理画面側の値に統一する
             （Appleデザインチーム視点レビュー・ラウンド37での指摘：admin.jsの使用箇所が多いため、そちらを
             正として揃える）。 */
          --info-bg: #e3f2fd;
          --info-border: #bcdcff;
          --info-text: #1565c0;
          --warning-bg: #fff3e0;
          --warning-border: #ffe0b2;
          --warning-text: #e65100;
          --input-bg: #fafafa;
          --input-focus-bg: #fff;
          --danger-bg: #ffebee;
          --danger-border: #ffcccc;
          --tag-bg: #f0fff4;
          --tag-border: #b2ecc8;
          --tag-text: #2d7a4e;
          --kwarn-bg: #fff8e1;
          --kwarn-border: #ffcc02;
          --kwarn-title: #e65100;
          --kwarn-body: #5d4037;
          --policy-bg: #fffbef;
          --policy-border: #ffe082;
          --policy-text: #6d5200;
          --deadline-text: #b45309;
          --disabled-bg: #f5f5f5;
          --disabled-border: #ccc;
          --disabled-text: #999;
          --sat-blue: #1565c0;
          --overlay-bg: rgba(245,245,245,0.92);
        }
        /* このファイル（お客様向け予約画面）だけダークモード対応が丸ごと無く、LINEアプリ内WebView等で
           OSがダークモードのお客様には終始明るい画面が出続けていた（manual.js/privacy.js/spec.jsは
           対応済みなのに、実際にお客様が使う本体だけ抜けていた。アップルデザインチーム視点レビューでの
           指摘）。他のページと同じ手法で、:rootの変数だけダークモード用に上書きする（個々のスタイル定義は
           全て既にこれらの変数経由で書かれているため、変数の上書きだけで全体に反映される）。 */
        @media (prefers-color-scheme: dark) {
          :root {
            --bg: #121212;
            --white: #1e1e1e;
            --text: #eee;
            --sub: #aaa;
            --hint: #777;
            --border: #3a4149;
            --red: #ff6b6b;
            --sat-blue: #6fa8dc;
            --info-bg: #16283a;
            --info-border: #2c4a6b;
            --info-text: #6ab3f0;
            --warning-bg: #3a2712;
            --warning-border: #6b4a1f;
            --warning-text: #ffab5c;
            --input-bg: #2a2a2a;
            --input-focus-bg: #333;
            --danger-bg: #3a1518;
            --danger-border: #6b2a2a;
            --tag-bg: #16281c;
            --tag-border: #2d7a4e;
            --tag-text: #7fd9a8;
            --kwarn-bg: #2b2410;
            --kwarn-border: #8a6d1f;
            --kwarn-title: #f0a860;
            --kwarn-body: #d9c2a0;
            --policy-bg: #2b2410;
            --policy-border: #8a6d1f;
            --policy-text: #e0c070;
            --deadline-text: #f0a860;
            --disabled-bg: #2a2a2a;
            --disabled-border: #555;
            --disabled-text: #777;
            --overlay-bg: rgba(30,30,30,0.92);
          }
        }
        body { background: var(--bg); color: var(--text); min-height: 100vh; padding-bottom: 40px; }
        .header { background: var(--green); padding: 16px 16px 18px; text-align: center; position: sticky; top: 0; z-index: 10; }
        .header h1 { font-size: 20px; font-weight: bold; color: #fff; letter-spacing: 4px; }
        .header p { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 3px; letter-spacing: 1px; }
        .scr { padding: 14px; max-width: 480px; margin: 0 auto; }
        .mt8 { margin-top: 8px; }
        .mt12 { margin-top: 12px; }
        .mt16 { margin-top: 16px; }
        .card { background: var(--white); border-radius: 12px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .card-lbl { font-size: 12px; font-weight: bold; color: var(--sub); padding: 11px 16px 9px; border-bottom: 1px solid var(--border); letter-spacing: 0.5px; }
        .avail-loading { color: var(--hint); font-weight: normal; }
        .avail-info { color: var(--green); font-weight: normal; }
        .card-body { padding: 16px; }
        .course-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .course-nm { font-size: 16px; font-weight: bold; }
        .course-pr { font-size: 20px; font-weight: bold; color: var(--green); white-space: nowrap; }
        .course-pr small { font-size: 11px; font-weight: normal; color: var(--sub); }
        .course-dc { font-size: 12px; color: var(--sub); margin-top: 8px; line-height: 1.7; }
        .tag { display: inline-block; background: var(--tag-bg); color: var(--green); font-size: 11px; border-radius: 4px; padding: 2px 7px; margin-top: 8px; }
        input[type='date'], input[type='text'], input[type='tel'], input[type='email'], textarea {
          width: 100%; padding: 13px 14px; border: 1.5px solid var(--border); border-radius: 8px;
          font-size: 16px; font-family: inherit; color: var(--text); background: var(--input-bg);
          -webkit-appearance: none; transition: border-color 0.15s; box-sizing: border-box;
        }
        input:focus, textarea:focus { outline: none; border-color: var(--green); background: var(--input-focus-bg); }
        textarea { resize: none; }
        .g-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
        .g-btn, .t-btn, .c-btn {
          padding: 10px 4px; min-height: 44px; border: 1.5px solid var(--border); border-radius: 8px;
          background: var(--white); font-size: 13px; font-weight: bold; color: var(--text);
          cursor: pointer; text-align: center; transition: all 0.15s;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        }
        .g-btn-main { font-size: 13px; font-weight: bold; line-height: 1; }
        .g-btn-sub { font-size: 10px; font-weight: normal; color: var(--red); line-height: 1; }
        .g-btn.sel, .t-btn.sel, .c-btn.sel { background: var(--green); border-color: var(--green); color: #fff; }
        .g-btn.sel .g-btn-sub { color: rgba(255,255,255,0.8); }
        .g-btn.dis { opacity: 0.5; cursor: not-allowed; pointer-events: none; background: var(--disabled-bg); }
        .g-btn-k {
          width: 100%; margin-top: 8px; padding: 14px; border: 1.5px solid var(--border); border-radius: 8px;
          background: var(--white); font-size: 13px; font-weight: bold; color: var(--sub);
          cursor: pointer; text-align: center; transition: all 0.15s;
        }
        .g-btn-k.sel { background: var(--green); border-color: var(--green); color: #fff; }
        .g-btn-k.dis { opacity: 0.5; cursor: not-allowed; pointer-events: none; background: var(--disabled-bg); border-color: var(--disabled-border); color: var(--disabled-text); }
        .k-panel { margin-top: 12px; padding: 12px 14px; background: var(--tag-bg); border: 1px solid var(--tag-border); border-radius: 8px; }
        .k-note { font-size: 12px; color: var(--tag-text); line-height: 1.7; }
        .k-warning { margin-top: 12px; padding: 14px; background: var(--kwarn-bg); border: 1.5px solid var(--kwarn-border); border-radius: 10px; }
        .k-warning-title { font-size: 13px; font-weight: bold; color: var(--kwarn-title); margin-bottom: 8px; }
        .k-warning-body { font-size: 13px; color: var(--kwarn-body); line-height: 1.7; margin-bottom: 12px; }
        .k-warning-btns { display: flex; flex-direction: column; gap: 0; }
        .q-btn-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .q-btn { padding: 9px 14px; border: 1.5px solid var(--border); border-radius: 20px; background: var(--white); font-size: 13px; color: var(--text); cursor: pointer; transition: all 0.15s; }
        .q-btn.sel { background: var(--green); border-color: var(--green); color: #fff; }
        .c-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .t-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .t-btn { padding: 14px 4px; }
        .btn-p { display: block; width: 100%; padding: 17px; background: var(--green); color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: bold; cursor: pointer; letter-spacing: 0.3px; transition: opacity 0.15s; }
        .btn-p:active:not(:disabled) { opacity: 0.8; }
        .btn-p:disabled { background: var(--disabled-border); cursor: not-allowed; }
        .btn-s { display: block; width: 100%; padding: 15px; background: var(--white); color: var(--sub); border: 1.5px solid var(--border); border-radius: 12px; font-size: 15px; cursor: pointer; }
        .myres-link { display: block; width: 100%; padding: 14px; background: var(--white); color: var(--green); border: 1.5px solid var(--green); border-radius: 12px; font-size: 14px; font-weight: bold; cursor: pointer; text-align: center; }
        .err { background: var(--danger-bg); border: 1px solid var(--danger-border); border-radius: 8px; padding: 12px 14px; font-size: 13px; color: var(--red); }
        .cf-row { display: flex; padding: 13px 16px; border-bottom: 1px solid var(--border); gap: 12px; align-items: flex-start; }
        .cf-row:last-child { border-bottom: none; }
        /* white-space:nowrapは「ご来店日」等の固定の短いラベル専用に設計されていたが、Q1/Q2の
           見出し（q1Question/q3Question）が店舗の自由入力になったことで長文になり得るようになり、
           親の.card（overflow:hidden）で無音にクリップされていた（審判団バックログ一括レビューでの
           指摘）。折り返しを許可する。 */
        .cf-lbl { font-size: 12px; color: var(--sub); min-width: 72px; padding-top: 2px; white-space: normal; word-break: break-word; }
        .cf-val { font-size: 14px; font-weight: bold; flex: 1; line-height: 1.5; }
        .cf-val.acc { color: var(--green); }
        .policy { background: var(--policy-bg); border: 1px solid var(--policy-border); border-radius: 8px; padding: 12px 14px; font-size: 12px; color: var(--policy-text); line-height: 1.7; }
        .done-card { background: var(--white); border-radius: 12px; padding: 36px 20px 32px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .done-ck { width: 72px; height: 72px; background: var(--green); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 36px; color: #fff; }
        .done-ttl { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .done-sub { font-size: 13px; color: var(--sub); line-height: 1.8; }
        .done-id { font-size: 11px; color: var(--hint); margin-top: 12px; }
        .res-card { background: var(--white); border-radius: 12px; padding: 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .res-date { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
        .res-detail { font-size: 13px; color: var(--sub); line-height: 1.7; }
        .res-actions { display: flex; gap: 8px; margin-top: 12px; }
        .btn-chg { flex: 1; padding: 11px; min-height: 44px; display: flex; align-items: center; justify-content: center; background: var(--tag-bg); color: var(--green); border: 1.5px solid var(--green); border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; box-sizing: border-box; }
        .btn-cnl { flex: 1; padding: 11px; min-height: 44px; display: flex; align-items: center; justify-content: center; background: var(--danger-bg); color: var(--red); border: 1.5px solid var(--danger-border); border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; box-sizing: border-box; }
        .cnl-confirm { background: var(--danger-bg); border: 1px solid var(--danger-border); border-radius: 8px; padding: 12px 14px; margin-top: 10px; }
        .cnl-msg { font-size: 13px; color: var(--red); margin-bottom: 10px; }
        .cnl-btns { display: flex; gap: 8px; }
        .cnl-yes { flex: 1; padding: 11px; min-height: 44px; display: flex; align-items: center; justify-content: center; background: var(--red); color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; box-sizing: border-box; }
        .cnl-no { flex: 1; padding: 11px; min-height: 44px; display: flex; align-items: center; justify-content: center; background: var(--white); color: var(--sub); border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; cursor: pointer; box-sizing: border-box; }
        .no-res { text-align: center; padding: 40px 20px; color: var(--hint); font-size: 14px; }
        .chg-current { background: var(--input-bg); border-radius: 8px; padding: 12px 14px; font-size: 13px; color: var(--sub); line-height: 1.8; }
        .ld-wrap { text-align: center; padding: 80px 20px; }
        .dots { display: flex; justify-content: center; gap: 8px; }
        .dot { width: 10px; height: 10px; background: var(--green); border-radius: 50%; animation: blink 1.2s infinite; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        .ld-txt { margin-top: 20px; font-size: 14px; color: var(--sub); }
        /* .hintクラスは「エラーではないが必ず読んでほしい注意書き」（受付できる時間帯の案内、
           メール登録のお願い、代表者の扱い等）に使われており、装飾的な補足文言（凡例・広告ラベル等、
           こちらは引き続きvar(--hint)を直接使う）とは役割が異なる。従来はvar(--hint)（#aaa/#777、
           白背景に対してコントラスト比 約2.3:1）と非常に薄く、重要な案内文が読みにくかった
           （審判団指摘対応）。既存のセカンダリテキスト用var(--sub)（#666/#aaa、コントラスト比
           約5.7:1以上でWCAG AA相当）に変更し、装飾的な用途には影響を与えない。 */
        .hint { font-size: 11px; color: var(--sub); margin-top: 7px; line-height: 1.6; }
        .deadline-note { font-size: 13px; font-weight: bold; color: var(--deadline-text); margin-top: 7px; line-height: 1.6; }
        .optional-toggle {
          width: 100%; text-align: left; background: transparent; border: 1.5px dashed var(--border);
          border-radius: 12px; padding: 13px 16px; margin-bottom: 14px; font-size: 13px; color: var(--sub);
          cursor: pointer;
        }
        .card-lbl-optional { font-size: 12px; font-weight: normal; color: var(--sub); opacity: 0.75; padding: 11px 16px 9px; border-bottom: 1px dashed var(--border); letter-spacing: 0.5px; }
      `}</style>
    </>
  )
}
