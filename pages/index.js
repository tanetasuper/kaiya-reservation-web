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

function addMin(t, m) {
  const [h, mn] = t.split(':').map(Number)
  const tot = h * 60 + mn + m
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
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
        <button key={s} className={`t-btn${value === s ? ' sel' : ''}`} onClick={() => onChange(s)}>
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
    cells.push({ d, ymd, info, isDisabled, isSelected: ymd === selected, isToday: ymd === todayYMD })
  }

  function mark(info, isDisabled) {
    if (isDisabled) return { text: info.status === 'blocked' || info.status === 'full' ? '✕' : '', color:'var(--hint)', label:t('満席・休業') }
    if (info.status === 'few')  return { text:'△', color:'var(--kwarn-title)', label:t('残席わずか') }
    if (info.status === 'open') return { text:'○', color:'var(--green)', label:t('空きあり') }
    return { text:'', color:'transparent', label:'' }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <button onClick={onPrev} disabled={loading} aria-label={t('前の月')} style={{ padding:'8px 16px', background:'var(--input-bg)', border:'none', borderRadius:8, fontSize:17, cursor: loading ? 'default' : 'pointer', color: loading ? 'var(--disabled-border)' : 'var(--sub)' }}>←</button>
        <span style={{ fontWeight:'bold', fontSize:16, color:'var(--text)' }}>{lang === 'en' ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month]} ${year}` : `${year}年${month+1}月`}</span>
        <button onClick={onNext} disabled={loading} aria-label={t('次の月')} style={{ padding:'8px 16px', background:'var(--input-bg)', border:'none', borderRadius:8, fontSize:17, cursor: loading ? 'default' : 'pointer', color: loading ? 'var(--disabled-border)' : 'var(--sub)' }}>→</button>
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
            const mk = mark(cell.info, cell.isDisabled)
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
        <span style={{ color:'var(--red)', fontWeight:'bold' }}>✕ {t('満席/休業')}</span>
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

  // コース設定（管理画面から取得）
  const [settingsCourses, setSettingsCourses] = useState([{ name:'季節の貝フルコース', price:11000, description:'旬の貝と野菜をふんだんに使ったコースメニュー', duration:150, mealType:'dinner' }])
  const [selCourse, setSelCourse] = useState(0)
  const [settingsTimeRanges, setSettingsTimeRanges] = useState([
    { type:'lunch', label:'ランチ', start:'11:30', end:'14:00' },
    { type:'dinner', label:'ディナー', start:'17:00', end:'21:00' },
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
  const [featureFlags, setFeatureFlags] = useState({ waitlistEnabled: true, lateRequestEnabled: true, kasshikiEnabled: true })
  // 店名・電話番号等は設定（getSettings）から取得する。取得前・取得失敗時は現行の貝屋和光の値を既定にする
  // （汎用予約システムとして他店舗に導入する場合はここが管理画面の設定だけで変わる）。
  const [bizName, setBizName] = useState('貝屋和光')
  const [bizTagline, setBizTagline] = useState('築地／貝焼き専門店')
  const [bizAddress, setBizAddress] = useState('')
  const [storeImageUrl, setStoreImageUrl] = useState('')
  const [bizPhone, setBizPhone] = useState('080-9391-1475')
  const [q1Options, setQ1Options] = useState(['誕生日・記念日', '接待・会食', '友人・仲間と', '家族で', 'デート', 'その他'])
  const [q3Options, setQ3Options] = useState(['グーグルマップ', 'インターネット検索', '食べログ', 'SNS', '知人の紹介', 'その他'])
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
  const [showOptional, setShowOptional] = useState(false)
  const [companions, setCompanions] = useState([{ name: '', allergy: '' }])
  const [inputErr, setInputErr] = useState('')
  const [cfErr, setCfErr] = useState('')
  const [privacyConsent, setPrivacyConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState({ detail: '', id: '', pending: false, error: '', backScreen: 'confirm', title: 'ご予約を承りました' })

  // キャンセル待ち
  const [wlSubmitting, setWlSubmitting] = useState(false)
  const [wlDone, setWlDone] = useState(false)
  const [wlErr, setWlErr] = useState('')

  // 予約一覧
  const [myRes, setMyRes] = useState([])
  const [myResLoading, setMyResLoading] = useState(false)
  const [cancelId, setCancelId] = useState(null)
  const [cancelingId, setCancelingId] = useState(null)
  const [cancelErr, setCancelErr] = useState('')
  const [myResErr, setMyResErr] = useState('')
  const [myResNeedsPhone, setMyResNeedsPhone] = useState(false)
  const [myResPhoneInput, setMyResPhoneInput] = useState('')
  const [myResPhoneUsed, setMyResPhoneUsed] = useState('')
  const [myResNameInput, setMyResNameInput] = useState('')
  const [myResNameUsed, setMyResNameUsed] = useState('')
  const [lateReqId, setLateReqId] = useState(null)
  const [lateReqType, setLateReqType] = useState('change')
  const [lateReqMsg, setLateReqMsg] = useState('')
  const [lateReqSubmitting, setLateReqSubmitting] = useState(false)
  const [lateReqDoneIds, setLateReqDoneIds] = useState(new Set())
  const [lateReqErr, setLateReqErr] = useState('')

  // 変更フォーム
  const [changingRes, setChangingRes] = useState(null)
  const [chgDate, setChgDate] = useState('')
  const [chgTime, setChgTime] = useState('')
  const [chgGuests, setChgGuests] = useState('')
  const [chgMsg, setChgMsg] = useState('')
  const [chgErr, setChgErr] = useState('')
  const [chgcfErr, setChgcfErr] = useState('')
  const [chgSubmitting, setChgSubmitting] = useState(false)

  const effectiveGuests = !guestCountEnabled ? fixedGuestCount : (selGuest === 'konsult' ? '' : selGuest)
  const t = useMemo(() => makeT(lang), [lang])
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
      const rows = companions.slice(0, companionCount()).map((c, i) => {
        const label = c.name.trim() || `${i + 1}人目`
        return c.allergy.trim() ? `${label}：${c.allergy.trim()}` : null
      }).filter(Boolean)
      if (rows.length) parts.push('【同伴者情報】\n' + rows.join('\n'))
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
    return `※ 来店日の${rule.daysBefore}日前（${mo}/${da}）${rule.time}まで受付`
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
  function guestLabel(n) {
    if (!avail || availLoading) return `${n}名`
    if (n === 1 && !avail.canBook1) return `1名\n×`
    if (capacityModel === 'perStaff') return (n >= 2 && !avail.canBook2to5) ? `${n}名\n満席` : `${n}名`
    if (n >= 2 && n <= 5 && n > avail.remainingSeats) return `${n}名\n満席`
    return `${n}名`
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

  // ===== 空席取得 =====
  async function fetchAvailability(date, time, course, staff) {
    if (!date) return
    setAvailLoading(true)
    setAvail(null)
    setAvailErr('')
    try {
      const r = await api.getAvailability(date, time, course, staff)
      setAvail(r)
    } catch {
      setAvail(null)
      setAvailErr(capacityModel === 'perStaff'
        ? staffCheckFailText()
        : t('残席の確認に失敗しました。電波の良い場所でもう一度お試しください。'))
    }
    setAvailLoading(false)
  }

  // ===== 受付期限後の変更・キャンセルをLINEで依頼 =====
  async function submitLateRequest(res) {
    setLateReqSubmitting(true)
    setLateReqErr('')
    try {
      const r = await api.requestLateChangeOrCancel({
        reservationId: res.id, lineUserId: profile?.userId || '', phone: myResPhoneUsed, name: myResNameUsed,
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
  async function joinWaitlist(targetDate, targetGuests) {
    if (!name.trim() || !phone.trim()) { setWlErr(t('お名前と電話番号を入力してください')); return }
    setWlSubmitting(true)
    setWlErr('')
    try {
      const r = await api.joinWaitlist({
        lineUserId: profile?.userId || '',
        name: name.trim(), phone: phone.trim(),
        // ||ではなく明示的なundefinedチェックにする。変更フローはchgGuestsが未選択（''）の状態でも
        // このカードを表示・送信できてしまうため、'||'だと''が偽値としてeffectiveGuests（新規予約
        // フロー側の、無関係な古いselGuestの値が残っている可能性がある変数）にフォールバックしてしまい、
        // 変更フローからの登録なのに別フローの人数が紛れ込む（ランダム客層視点レビューでの指摘）。
        date: targetDate !== undefined ? targetDate : selDate,
        guests: targetGuests !== undefined ? targetGuests : (effectiveGuests || ''),
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
    if (d) {
      // 空席取得は祝日データに依存しないため、ensureHolidays()の完了を待たずに並行して開始する。
      // （以前は直列にawaitしていたため、初回のみ祝日取得が最大5秒かかる間、
      // セッション最初の日付タップだけ何も起きていないように見えていた）。
      fetchAvailability(d, undefined, visibleCourses[selCourse]?.name)
      ensureHolidays()
    }
  }

  // LINEログイン後／ゲストモード決定後の共通の画面遷移（URLパラメータでマイ予約に直接遷移する分岐を含む）
  const proceedAfterAuth = useCallback((userId, isGuest) => {
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
      api.getMyReservations(userId).then(r => {
        setMyRes(r.success ? r.list || [] : [])
      }).catch(() => {
        setMyRes([])
      }).finally(() => setMyResLoading(false))
    } else {
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
    try {
      await Promise.race([
        window.liff.init({ liffId: LIFF_ID }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ])
      if (window.liff.isLoggedIn()) {
        const p = await window.liff.getProfile()
        setProfile(p)
        userId = p.userId
        // リピーター情報はバックグラウンドで取得（画面遷移をブロックしない）
        api.getCustomerProfile(p.userId).then((cp) => {
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
    proceedAfterAuth(userId, isGuestFallback)
  }, [proceedAfterAuth])

  // 店名・コース一覧・営業時間等はオーナーが設定変更した時だけ変わる、頻繁には変わらないデータのため、
  // 再訪問時にlocalStorageのキャッシュを即座に反映してから、裏側で最新版を取りに行く
  // （stale-while-revalidate。初回表示が速くなり、万一通信が遅い時も「何も出ない」状態を避けられる）。
  const SETTINGS_CACHE_KEY = 'kaiya_settings_cache_v1'
  function applySettingsResponse(r) {
    if (!r || !r.success) return
    if (r.courses && r.courses.length > 0) { setSettingsCourses(r.courses); setSelCourse(0) }
    if (r.timeRanges && r.timeRanges.length > 0) setSettingsTimeRanges(r.timeRanges)
    if (r.dailyHours) setSettingsDailyHours(r.dailyHours)
    if (r.dateOverrides) setSettingsDateOverrides(r.dateOverrides)
    if (r.cutoffRules) setSettingsCutoffRules(r.cutoffRules)
    if (r.bookingNotes) setBookingNotes(r.bookingNotes)
    if (r.featureFlags) setFeatureFlags(r.featureFlags)
    if (r.restaurantName) setBizName(r.restaurantName)
    if (r.restaurantTagline) setBizTagline(r.restaurantTagline)
    if (r.restaurantAddress) setBizAddress(r.restaurantAddress)
    if (r.storeImageUrl) setStoreImageUrl(r.storeImageUrl)
    if (r.contactPhone) setBizPhone(r.contactPhone)
    if (r.q1Options && r.q1Options.length > 0) setQ1Options(r.q1Options)
    if (r.q3Options && r.q3Options.length > 0) setQ3Options(r.q3Options)
    if (r.bookingMode) setBookingMode(r.bookingMode)
    if (r.itemLabel) setItemLabel(r.itemLabel)
    if (r.itemIcon) setItemIcon(r.itemIcon)
    if (r.adBannerEnabled) setAdBanner({ enabled: true, imageUrl: r.adBannerImageUrl || '', text: r.adBannerText || '', linkUrl: r.adBannerLinkUrl || '', placements: (r.adBannerPlacements && r.adBannerPlacements.length) ? r.adBannerPlacements : ['done'] })
    if (r.capacityModel) setCapacityModel(r.capacityModel)
    if (r.staffLabel) setStaffLabel(r.staffLabel)
    if (r.countUnit) setCountUnit(r.countUnit)
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

  // ===== バリデーション =====
  // エラー発生時、原因の項目までスクロールして分かりやすくする
  function scrollToCard(id) {
    if (typeof document === 'undefined') return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function errAt(id, msg) {
    setInputErr(msg)
    scrollToCard(id)
  }

  function goConfirm() {
    if (!selDate) return errAt('card-date', t('ご来店日を選択してください'))
    // 変更フロー（2117行目付近）には元々あった「選択日が受付期限を過ぎていないか」の最終チェックが、
    // 新規予約フローのここには無かった（ランダム客層視点レビューでの指摘：過去ラウンドの教訓と逆で、
    // 変更フローには実装済みなのに主フローに実装漏れがあったパターン）。dateMinは初回読み込み時に
    // 一度だけ計算する近似値のため、①カレンダー表示中に締切時刻をまたいでそのまま送信された場合、
    // ②店舗が締切ルール（settingsCutoffRules）を既定値と異なる設定に変更した場合、のいずれも
    // カレンダー上は選択可能に見えたまま実際の締切を過ぎて送信できてしまっていた。
    if (deadlinePassed(selDate)) return errAt('card-date', t('選択された日付は予約受付期限を過ぎています'))
    if (!selTime) return errAt('card-time', t('来店時間を選択してください'))
    if (guestCountEnabled && !selGuest && !isKasshiki) return errAt('card-guest', t('人数を選択してください'))
    if (!String(name).trim()) return errAt('card-contact', t('お名前を入力してください'))
    if (!String(phone).trim()) return errAt('card-contact', t('電話番号を入力してください'))
    if (emailCollectionEnabled && isGuestMode && !String(email).trim()) return errAt('card-contact', t('メールアドレスを入力してください'))
    if (avail && !isKasshiki && selGuest) {
      const n = parseInt(selGuest) || 0
      if (capacityModel === 'perStaff') {
        if (n >= 2 && !avail.canBook2to5) return errAt('card-guest', lang === 'en' ? `No ${staffLabel} available for this time slot` : `この時間帯はご案内できる${staffLabel}が見つかりません`)
      } else if (n >= 2 && n > avail.remainingSeats) {
        return errAt('card-guest', lang === 'en' ? `Only ${avail.remainingSeats} ${countUnit} remaining, so we can't accept a party of ${n}` : `残り${avail.remainingSeats}${countUnit}のため、${n}名様のご予約はお受けできません`)
      }
      if (n === 1 && !avail.canBook1)
        return errAt('card-guest', t('1名様のご予約はこの日はお受けできません'))
    }
    setInputErr('')
    if (bookingNotes) {
      setShowNotesPopup(true)
    } else {
      setScreen('confirm')
    }
  }

  // 予約済みレコードの人数表示（'未定'＝人数未確定の予約は言語に応じて翻訳表示する。
  // 生の '未定' 文字列に t('名様') を連結すると英語表示時に "未定 guests" のような
  // 言語混在表示になってしまうため、未確定値は必ず t('人数未定') 経由で表示する）
  function guestsDisplay(g) {
    return (g && g !== '未定') ? `${g}${t('名様')}` : t('人数未定')
  }

  // ===== 予約送信 =====
  async function submitReservation() {
    setSubmitting(true)
    setCfErr('')
    setPrivacyConsent(false)
    const d = parseDate(selDate)
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    const guestStr = selGuest === 'konsult' ? t('13名以上・人数未定（ご相談）') : effectiveGuests ? `${effectiveGuests}${t('名様')}` : t('人数未定')
    const baseDetail = `${fmtDateLang(selDate, lang)}　${selTime}〜${addMin(selTime, selStayMin)}\n${guestStr}${isKasshiki ? t('（貸切）') : ''}`
    const doneTitle = isKasshiki ? t('貸切お申し込みを受け付けました') : t('ご予約を承りました')
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'confirm', title: doneTitle, pendingApproval: isKasshiki })
    setScreen('done')
    try {
      const r = await api.createReservation({
        lineUserId: profile?.userId || 'unknown',
        displayName: profile?.displayName || '',
        pictureUrl: profile?.pictureUrl || '',
        name: String(name).trim(),
        phone: String(phone).trim(),
        date: dateStr,
        time: selTime,
        guests: effectiveGuests || '未定',
        course: visibleCourses[selCourse]?.name || itemLabel,
        isKasshiki,
        isKonsult,
        notes: buildNotesPayload(),
        q1: q1 === 'その他' ? (q1Other.trim() || 'その他') : q1,
        q2: '',
        q3: q3 === 'その他' ? (q3Other.trim() || 'その他') : q3,
        requestedStaff: staffAssignmentEnabled ? selStaff : '',
        email: emailCollectionEnabled ? String(email).trim() : '',
        language: lang,
      })
      if (r.success) {
        const doneMsg = isKasshiki
          ? baseDetail + '\n\n' + t('内容を確認後、ご連絡いたします。')
          : baseDetail + t('\n\nLINEに確認メッセージをお送りしました。')
        setDone({ detail: doneMsg, id: `${t('予約番号：')}${r.reservationId}`, pending: false, error: '', backScreen: 'confirm', title: doneTitle, pendingApproval: isKasshiki })
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
    await ensureHolidays()
    setMyRes([])
    setMyResErr('')
    setCancelId(null)
    setScreen('myres')
    if (isGuestMode) {
      setMyResNeedsPhone(true)
      return
    }
    setMyResLoading(true)
    try {
      const r = await api.getMyReservations(profile?.userId || '')
      if (r.success) setMyRes(r.list || [])
      else { setMyRes([]); setMyResErr(t('予約の読み込みに失敗しました。もう一度お試しください。')) }
    } catch {
      setMyRes([])
      setMyResErr(t('通信エラーが発生しました。もう一度お試しください。'))
    }
    setMyResLoading(false)
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
  }

  async function execCancel(id) {
    setCancelingId(id)
    setCancelErr('')
    try {
      const r = await api.cancelReservation({ reservationId: id, lineUserId: profile?.userId || '', phone: myResPhoneUsed, name: myResNameUsed })
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

  // ===== 変更フォーム =====
  function openChangeForm(res) {
    setChangingRes(res)
    setChgDate('')
    setChgTime('')
    setChgGuests(/^\d+$/.test(String(res.guests)) ? String(res.guests) : '')
    setChgMsg('')
    setChgErr('')
    setAvail(null)
    // wlDone/wlErrは新規予約フローと共有のstate。変更フローに満席日のキャンセル待ち案内を追加したことで、
    // 別の日付・別の画面で過去に登録済み／エラーになった状態がそのまま持ち越されて見えてしまう
    // （例：新規予約フローで別日のキャンセル待ちに登録済みのまま変更フローを開くと、まだ登録していない
    // 変更先の日付でも「✅登録しました」と誤表示される）。onDateChange（748行目）と同様にリセットする。
    setWlDone(false)
    setWlErr('')
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
    if (d) {
      // 空席取得は祝日データに依存しないため、onDateChangeと同様に並行して開始する。
      fetchAvailability(d, undefined, changingRes?.course)
      ensureHolidays()
    }
  }

  // 変更後の人数ボタン用：同日のまま人数だけ増やす場合は、自分自身の予約分の席を残席に加算して判定する
  function chgGuestDisabled(n) {
    if (availErr) return true
    if (!avail || availLoading) return false
    const sameDay = changingRes && chgDate && chgDate.replace(/-/g, '/') === changingRes.date
    const ownSeats = sameDay ? (parseInt(changingRes.guests) || 0) : 0
    if (n === 1) return !avail.canBook1
    if (capacityModel === 'perStaff') return n >= 2 && !avail.canBook2to5
    if (n >= 2) return n > (avail.remainingSeats + ownSeats)
    return false
  }

  async function submitChange() {
    setChgSubmitting(true)
    setChgcfErr('')
    const d = parseDate(chgDate)
    const nd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    // submitReservation（941行目）と同じくfmtDateLang/t('名様')を使う。以前はfmtDate（日本語専用の
    // M月D日（曜）表記）と「名様」ハードコードのままで、変更完了直後の画面だけ英語モードでも
    // 日本語のまま表示されていた（ランダム客層視点レビューでの指摘）。
    const baseDetail = `${fmtDateLang(chgDate, lang)}　${chgTime}〜${addMin(chgTime, chgStayMin)}\n${effectiveChgGuests}${t('名様')}`
    // Optimistic UI：先に done 画面へ遷移し、API はバックグラウンドで送信
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'chgconfirm', title: t('変更が完了しました') })
    setScreen('done')
    try {
      const r = await api.changeReservation({
        reservationId: changingRes.id,
        lineUserId: profile?.userId || '',
        phone: myResPhoneUsed,
        name: myResNameUsed,
        newDate: nd,
        newTime: chgTime,
        newGuests: effectiveChgGuests,
        message: chgMsg.trim(),
      })
      if (r.success) {
        setDone({ detail: baseDetail + t('\n\nLINEに変更確認メッセージをお送りしました。'), id: `${t('予約番号：')}${changingRes.id}`, pending: false, error: '', backScreen: 'chgconfirm', title: t('変更が完了しました') })
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
          '@type': 'LocalBusiness',
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
            {longWait && <p className="ld-txt" style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>{t('通信状況により、時間がかかる場合があります。しばらくお待ちください。')}</p>}
          </div>
        </div>
      )}

      {/* ── INPUT FORM ── */}
      {screen === 'input' && (
        <div className="scr">
          {isGuestMode && (
            <div style={{ background:'var(--info-bg)', border:'1px solid var(--info-border)', borderRadius:10, padding:'10px 14px', marginBottom:12, fontSize:13, color:'var(--info-text)' }}>
              {t('LINEなしでご予約いただけます。ご予約の確認・変更・キャンセルは「マイ予約」から電話番号で検索できます')}{emailCollectionEnabled ? t('（メールアドレスをご登録いただくと確認メールもお送りします）') : ''}{t('。お困りの際はお電話（')}<a href={telHref(bizPhone)} style={{ color:'var(--info-text)', fontWeight:'bold' }}>{bizPhone}</a>{t('）にもご連絡いただけます。')}
            </div>
          )}
          {/* コース（コース無しモードでは選択UI自体を表示しない） */}
          {!isSimpleMode && (
          <div className="card">
            <div className="card-lbl">{itemIcon}　{itemLabel}</div>
            <div className="card-body">
              {visibleCourses.map((c, i) => (
                <div key={i}
                  className={`course-item${visibleCourses.length > 1 ? (selCourse === i ? ' sel' : '') : ''}`}
                  onClick={() => {
                    if (visibleCourses.length <= 1) return
                    setSelCourse(i)
                    // コースにより提供時間帯（ランチ/ディナー等）が変わるため、選択済みの時間はリセットする（人数はそのまま維持）
                    setSelTime('')
                    setInputErr('')
                    // コースが変わると滞在時間・残席計算の前提が変わるため、別コースの古い残席情報を
                    // 一瞬でも見せてしまわないようクリアする（時間を選び直すまで表示しない）
                    setAvail(null)
                    setAvailErr('')
                  }}
                  style={visibleCourses.length > 1 ? { cursor:'pointer', border: selCourse===i ? '2px solid var(--green)' : '2px solid var(--border)', borderRadius:10, padding:'10px 12px', marginBottom: i < visibleCourses.length-1 ? 8 : 0 } : {}}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {c.imageUrl && (
                      <img src={optimizedImageUrl(c.imageUrl, 112)} alt={c.name} loading="lazy" decoding="async"
                        style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                        onError={e => onOptimizedImageError(e, c.imageUrl)} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="course-row">
                        <div className="course-nm">{c.name}</div>
                        <div className="course-pr">¥{Number(c.price).toLocaleString()}<small>{lang === 'en' ? ' (tax incl.)' : '（税込）'}</small></div>
                      </div>
                      {c.description && <div className="course-dc">{c.description}</div>}
                      <div>
                        <span className="tag">{fmtDuration(c.duration, lang)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}

          {/* 来店日 */}
          <div className="card" id="card-date">
            <div className="card-lbl">{t('📅　ご来店日')}</div>
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
              <div className="card-lbl">
                {t('⏰　来店時間')}
                {!selTime && availLoading && <span className="avail-loading"> {t('確認中...')}</span>}
              </div>
              <div className="card-body">
                {selDate && courseTimeSlots.length === 0 ? (
                  <p className="hint">{t('この日はご案内できる時間帯がありません。別の日をお選びください。')}</p>
                ) : (
                  <>
                    <TimeGrid value={selTime} onChange={(s) => { setSelTime(s); setInputErr(''); if (selDate) fetchAvailability(selDate, s, visibleCourses[selCourse]?.name, staffAssignmentEnabled ? selStaff : undefined) }} slots={courseTimeSlots} />
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
              <div className="card-lbl">
                {t('👥　人数')}
                {availLoading && <span className="avail-loading"> {t('確認中...')}</span>}
                {avail && !availLoading && !isKasshiki && (
                  <span className="avail-info">
                    {lang === 'en'
                      ? (capacityModel === 'perStaff' ? ` ${avail.remainingSeats} ${staffLabel} available` : ` ${avail.remainingSeats} ${countUnit} remaining`)
                      : (capacityModel === 'perStaff' ? ` 対応可能な${staffLabel} ${avail.remainingSeats}${countUnit}` : ` 残り ${avail.remainingSeats}${countUnit}`)}
                  </span>
                )}
              </div>
              <div className="card-body" style={{ position: 'relative' }}>
                {availLoading && (
                  <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1 }}>
                    <span style={{ fontSize:13, color:'var(--hint)' }}>{capacityModel === 'perStaff' ? staffCheckingText() : t('空き状況を確認中...')}</span>
                  </div>
                )}
                {availErr && !availLoading && (
                  <div style={{ background:'var(--danger-bg)', border:'1px solid var(--danger-border)', borderRadius:8, padding:'10px 12px', marginBottom:10, fontSize:13, color:'var(--red)' }}>
                    {availErr}
                    <button onClick={() => fetchAvailability(selDate, selTime, visibleCourses[selCourse]?.name, staffAssignmentEnabled ? selStaff : undefined)}
                      style={{ marginLeft:8, background:'var(--white)', border:'1px solid var(--red)', color:'var(--red)', borderRadius:6, padding:'3px 10px', fontSize:12, cursor:'pointer' }}>
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
                        onClick={() => {
                          if (disabled) return
                          setSelGuest(String(n))
                          setIsKasshiki(false)
                          setIsKonsult(false)
                          setShowKasshikiWarning(false)
                          setInputErr('')
                        }}
                      >
                        <span className="g-btn-main">{lang === 'en' ? `${n} guest${n === 1 ? '' : 's'}` : `${n}名`}</span>
                        {isOccupied && <span className="g-btn-sub">{n === 1 ? t('条件あり') : t('満席')}</span>}
                      </button>
                    )
                  })}
                </div>

                {/* 満席日：キャンセル待ち登録（貸切が理由の満席は下の専用の案内を出すので、ここでは対象外にする） */}
                {featureFlags.waitlistEnabled && avail && !availLoading && !isKasshiki && !avail.hasKasshiki && avail.remainingSeats === 0 && (
                  <div style={{ background:'var(--warn-bg)', border:'1px solid var(--warn-border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>{t('この日は満席です。キャンセルが出た際にお知らせすることができます（先着順のためご案内をお約束するものではありません）。')}</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                        </div>
                        {wlErr && <div style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {/* キャンセル待ち登録も氏名・電話番号を収集するため、予約確定と同じ同意チェックを
                            必須にする（Apple CEO視点レビューでの指摘：確認画面を経由しないこの経路だけ
                            同意チェックをすり抜けていた） */}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warn-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
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
                      {konsultDisabled() && avail ? t('💬 13名以上・大人数のご相談 — 本日は受付不可') : t('💬 13名以上・大人数のご相談')}
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
                            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                          </div>
                        )}
                        {wlErr && <div style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {featureFlags.waitlistEnabled && (
                          <>
                            <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                              <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                            </label>
                            {!privacyConsent && (
                              <div style={{ fontSize:11, color:'var(--warn-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                            )}
                          </>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          {featureFlags.waitlistEnabled && (
                            <button onClick={() => joinWaitlist()} disabled={wlSubmitting || !privacyConsent}
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
                      const kPrice = Number(visibleCourses[selCourse]?.price) || 11000
                      const kGuests = Math.max(6, parseInt(selGuest) || 0)
                      const kTotal = (kPrice * kGuests).toLocaleString()
                      return lang === 'en' ? (
                        <p className="k-warning-body">Private-hire bookings require a <strong>minimum guaranteed spend for {kGuests} guests (¥{kTotal})</strong>.<br />Please only book if you agree to this.</p>
                      ) : (
                        <p className="k-warning-body">貸切プランのご利用には<strong>最低売上保証として{kGuests}名様分（¥{kTotal}）</strong>が発生いたします。<br />ご承知頂ける方のみご予約をお願いいたします。</p>
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
                    {selGuest && selGuest !== 'konsult' && <p className="k-note" style={{ marginTop:4 }}>{lang === 'en' ? `Selected party size: ${selGuest}` : `選択人数：${selGuest}名`}</p>}
                    {selGuest === 'konsult' && <p className="k-note" style={{ marginTop:4 }}>{t('13名以上・人数未定（ご相談）')}</p>}
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
            <div className="card-lbl">{t('📝　ご連絡先')}</div>
            <div className="card-body">
              <input type="text" value={name}
                onChange={(e) => { setName(e.target.value); setInputErr('') }}
                placeholder={t('お名前（例：山田 太郎）')} />
              <input type="tel" value={phone}
                onChange={(e) => { setPhone(e.target.value); setInputErr('') }}
                placeholder={t('電話番号（例：090-0000-0000）')}
                style={{ marginTop: 10 }} />
              {emailCollectionEnabled && (
                <>
                  <input type="email" value={email}
                    onChange={(e) => { setEmail(e.target.value); setInputErr('') }}
                    placeholder={isGuestMode ? t('メールアドレス（確認メールをお送りします）') : t('メールアドレス（任意）')}
                    style={{ marginTop: 10 }} />
                  {isGuestMode && <p className="hint" style={{ marginTop: 6 }}>{t('LINEでのご案内が届かないため、確認・変更・キャンセルのためにメールアドレスをご登録ください。')}</p>}
                </>
              )}
            </div>
          </div>

          {/* その他の情報（任意）：予約の必須項目ではないため、既定では折りたたんでおく */}
          {!showOptional ? (
            <button type="button" className="optional-toggle" onClick={() => setShowOptional(true)}>
              {(staffAssignmentEnabled && staffRoster.length > 0)
                ? t(`＋ ご指名・ご利用目的・ご要望等を追加する（任意）`)
                : t('＋ ご利用目的・ご要望等を追加する（任意）')}
            </button>
          ) : (
            <>
              {/* Q1・Q2：見出し・プレースホルダー自体は店舗の自由入力ではない固定UI文言のため翻訳対象。
                  選択肢（q1Options/q3Options）は店舗ごとの自由入力コンテンツのため、引き続き翻訳対象外
                  （ランダム客層視点レビューでの指摘：この「その他の情報（任意）」セクション全体の固定見出し・
                  プレースホルダーがt()経由になっておらず、英語モードでも常に日本語のまま表示されていた）。 */}
              {/* Q1 */}
              <div className="card">
                <div className="card-lbl card-lbl-optional">{t('Q1. ご利用目的（任意）')}</div>
                <div className="card-body">
                  <div className="q-btn-row">
                    {q1Options.map(opt => (
                      <button key={opt} className={`q-btn${q1 === opt ? ' sel' : ''}`}
                        onClick={() => { setQ1(q1 === opt ? '' : opt); setQ1Other('') }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  {q1 === 'その他' && (
                    <textarea rows={2} value={q1Other} onChange={e => setQ1Other(e.target.value)}
                      placeholder={t('具体的にご記入ください')} style={{ marginTop:10 }} />
                  )}
                </div>
              </div>

              {/* Q2 */}
              <div className="card">
                <div className="card-lbl card-lbl-optional">{t('Q2. どのように当店を知りましたか（任意）')}</div>
                <div className="card-body">
                  <div className="q-btn-row">
                    {q3Options.map(opt => (
                      <button key={opt} className={`q-btn${q3 === opt ? ' sel' : ''}`}
                        onClick={() => { setQ3(q3 === opt ? '' : opt); setQ3Other('') }}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  {q3 === 'その他' && (
                    <textarea rows={2} value={q3Other} onChange={e => setQ3Other(e.target.value)}
                      placeholder={t('具体的にご記入ください')} style={{ marginTop:10 }} />
                  )}
                </div>
              </div>

              {/* ご指名（担当者を指名できる業態のみ表示） */}
              {staffAssignmentEnabled && staffRoster.length > 0 && (
                <div className="card">
                  <div className="card-lbl card-lbl-optional">{t('🔖 ご指名（任意）')}</div>
                  <div className="card-body">
                    <div className="q-btn-row" style={{ opacity: availLoading ? 0.6 : 1 }}>
                      <button disabled={availLoading} className={`q-btn${selStaff === '' ? ' sel' : ''}`} onClick={() => { setSelStaff(''); if (selDate && selTime) fetchAvailability(selDate, selTime, visibleCourses[selCourse]?.name, undefined) }}>
                        {t('指名なし')}
                      </button>
                      {staffRoster.map(s => (
                        <button key={s.name} disabled={availLoading} className={`q-btn${selStaff === s.name ? ' sel' : ''}`} onClick={() => {
                          const next = selStaff === s.name ? '' : s.name
                          setSelStaff(next)
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
                  <div className="card-lbl card-lbl-optional">{t('ご一緒される方のお名前・ご要望等（任意）')}</div>
                  <div className="card-body">
                    {companions.slice(0, companionCount()).map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: i < companionCount() - 1 ? 8 : 0 }}>
                        <input type="text" value={c.name} onChange={(e) => updateCompanion(i, 'name', e.target.value)}
                          placeholder={lang === 'en' ? `Guest ${i + 1} name (optional)` : `${i + 1}人目のお名前（任意）`} style={{ flex: '1 1 40%' }} />
                        <input type="text" value={c.allergy} onChange={(e) => updateCompanion(i, 'allergy', e.target.value)}
                          placeholder={t('ご要望（アレルギー等、任意）')} style={{ flex: '1 1 60%' }} />
                      </div>
                    ))}
                    <p className="hint" style={{ marginTop: 8 }}>{t('1人目はご予約の代表者様です。お名前を書かなくても「1人目」として記録されます。')}</p>
                  </div>
                </div>
              )}

              {/* ご要望 */}
              <div className="card">
                <div className="card-lbl card-lbl-optional">{t('その他のご要望（任意）')}</div>
                <div className="card-body">
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('上記以外のご要望があればご記入ください')} />
                </div>
              </div>
            </>
          )}

          {inputErr && <div className="err mt12">{inputErr}</div>}
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
            <div className="card-lbl">{t('✅　ご予約内容の確認')}</div>
            {!isSimpleMode && (
              <div className="cf-row">
                <div className="cf-lbl">{itemLabel}</div>
                <div className="cf-val">
                  {visibleCourses[selCourse]?.name || itemLabel}
                  <br />
                  <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--sub)' }}>
                    ¥{Number(visibleCourses[selCourse]?.price || 11000).toLocaleString()}
                    {lang === 'en'
                      ? ` (tax incl.) / ${countUnit === '台' ? 'per unit' : 'per person'}　・　${fmtDuration(visibleCourses[selCourse]?.duration, lang)}`
                      : `（税込）/ ${countUnit === '台' ? `1${countUnit}` : 'お一人様'}　・　${fmtDuration(visibleCourses[selCourse]?.duration, lang)}`}
                  </span>
                </div>
              </div>
            )}
            <div className="cf-row">
              <div className="cf-lbl">{t('ご来店日')}</div>
              <div className="cf-val">{fmtDateLang(selDate, lang)}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('時間')}</div>
              <div className="cf-val">{selTime}〜{addMin(selTime, selStayMin)}（{t('目安')}）</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('人数')}</div>
              <div className="cf-val">{selGuest === 'konsult' ? t('13名以上・人数未定（ご相談）') : effectiveGuests ? `${effectiveGuests}${t('名様')}` : t('人数未定')}</div>
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
              <div className="cf-val">{name} {lang === 'en' ? '' : '様'}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('電話番号')}</div>
              <div className="cf-val">{phone}</div>
            </div>
            {q1.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">Q1</div>
                <div className="cf-val">{q1 === 'その他' ? (q1Other.trim() || 'その他') : q1.trim()}</div>
              </div>
            )}
            {q3.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">Q2</div>
                <div className="cf-val">{q3 === 'その他' ? (q3Other.trim() || 'その他') : q3.trim()}</div>
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
          {bookingNotes ? (
            <div className="policy" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setShowNotesPopup(true)}>
              <span style={{ fontSize:16 }}>⚠️</span>
              <span>{t('注意事項・キャンセルポリシーを確認する（タップで再表示）')}</span>
            </div>
          ) : null}
          {cfErr && <div className="err mt12">{cfErr}</div>}
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
            <div className="mt8" style={{ fontSize: 12, color: 'var(--warn-text)', textAlign: 'center' }}>{t('上記の同意チェックが必要です')}</div>
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
                  <div style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 10, padding: '10px 14px', margin: '0 0 12px', fontSize: 13, color: 'var(--warn-text)', fontWeight: 'bold' }}>
                    {t('※ まだ確定していません。店舗からの確認のご連絡をお待ちください。')}
                  </div>
                )}
                <div className="done-sub" style={{ whiteSpace: 'pre-line' }}>{done.detail}</div>
                <div className="done-id">{done.id}</div>
                <div className="mt16" style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
                  <button className="btn-p" onClick={() => {
                    setSelDate(''); setSelTime(''); setSelGuest(''); setSelCourse(0)
                    setIsKasshiki(false); setIsKonsult(false); setShowKasshikiWarning(false)
                    setQ1(''); setQ1Other(''); setQ3(''); setQ3Other(''); setNotes(''); setShowOptional(false)
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
              <div className="card-lbl">{t('📞　電話番号でご予約を確認')}</div>
              <div className="card-body">
                <p className="hint" style={{ marginBottom: 10 }}>{t('LINEをご利用でないため、ご予約時にご登録いただいたお名前・電話番号でご予約を検索します。')}</p>
                <input type="text" value={myResNameInput}
                  onChange={(e) => { setMyResNameInput(e.target.value); setMyResErr('') }}
                  placeholder={t('お名前（例：山田 太郎）')}
                  style={{ marginBottom: 10 }} />
                <input type="tel" value={myResPhoneInput}
                  onChange={(e) => { setMyResPhoneInput(e.target.value); setMyResErr('') }}
                  placeholder={t('電話番号（例：090-0000-0000）')} />
                {myResErr && <div className="err" style={{ marginTop: 10 }}>{myResErr}</div>}
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
            <div className="no-res" style={{ color: 'var(--red)' }}>
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
                  {res.notes ? <><br />💬 {res.notes}</> : null}
                </div>
                {res.status === '要確認' && (
                  <div style={{ marginTop: 6, background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--warn-text)', fontWeight: 'bold', display: 'inline-block' }}>
                    ⏳ {t('まだ確定していません（貸切・大人数のご相談中）')}
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
                          <button className={`q-btn${lateReqType === 'change' ? ' sel' : ''}`} onClick={() => setLateReqType('change')}>{t('変更したい')}</button>
                          <button className={`q-btn${lateReqType === 'cancel' ? ' sel' : ''}`} onClick={() => setLateReqType('cancel')}>{t('キャンセルしたい')}</button>
                        </div>
                        <textarea rows={2} value={lateReqMsg} onChange={e => setLateReqMsg(e.target.value)}
                          placeholder={t('ご希望の内容（例：来店時間を19時に変更したい）')} />
                        {lateReqErr && <div className="err" style={{ marginTop: 6 }}>{lateReqErr}</div>}
                        {/* この依頼文（自由記述）も新たに収集する個人情報のため、予約確定と同じ同意チェックを
                            必須にする（Apple CEO視点レビューでの指摘） */}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginTop:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warn-text)', marginTop:4 }}>{t('上記の同意チェックが必要です')}</div>
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
                      <div className="cnl-confirm">
                        <p className="cnl-msg">{t('本当にキャンセルしますか？')}</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" disabled={cancelingId === res.id} onClick={() => execCancel(res.id)}>
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
          <AdBannerSlot adBanner={adBanner} place="myres" style={{ marginTop: 12, marginBottom: 4 }} lang={lang} />
          <div className="mt8">
            <button className="btn-s" onClick={() => { setAvail(null); setAvailErr(''); setScreen('input') }}>{t('← 戻る')}</button>
          </div>
        </div>
      )}

      {/* ── CHANGE FORM ── */}
      {screen === 'change' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">{t('📝　変更対象の予約')}</div>
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
          {chgErr && <div className="err mt12">{chgErr}</div>}
          <div className="card" id="card-chg-date">
            <div className="card-lbl">{t('📅　新しいご来店日')}</div>
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
              <div className="card-lbl">{t('⏰　新しい来店時間')}</div>
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
                  <TimeGrid value={chgTime} onChange={(s) => { setChgTime(s); setChgErr(''); if (chgDate) fetchAvailability(chgDate, s, changingRes?.course) }} slots={chgTimeSlots} />
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
              <div className="card-lbl">{t('👥　人数')}</div>
              <div className="card-body" style={{ position: 'relative' }}>
                {availLoading && (
                  <div style={{ position:'absolute', inset:0, background:'var(--overlay-bg)', display:'flex', alignItems:'center', justifyContent:'center', borderRadius:12, zIndex:1 }}>
                    <span style={{ fontSize:13, color:'var(--hint)' }}>{capacityModel === 'perStaff' ? staffCheckingText() : t('空き状況を確認中...')}</span>
                  </div>
                )}
                <div className="g-row">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((n) => {
                    const disabled = chgGuestDisabled(n)
                    return (
                      <button key={n}
                        className={`g-btn${chgGuests === String(n) ? ' sel' : ''}${disabled ? ' dis' : ''}`}
                        disabled={disabled}
                        onClick={() => { if (!disabled) { setChgGuests(String(n)); setChgErr('') } }}>
                        <span className="g-btn-main">{lang === 'en' ? `${n} guest${n === 1 ? '' : 's'}` : `${n}名`}</span>
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
                  <div style={{ background:'var(--warn-bg)', border:'1px solid var(--warn-border)', borderRadius:8, padding:'12px 14px', margin:'10px 0', fontSize:13 }}>
                    {wlDone ? (
                      <div style={{ color:'var(--green)', fontWeight:'bold' }}>✅ {t('キャンセル待ちに登録しました。空きが出たらお知らせします。')}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom:8 }}>{t('この日は満席です。キャンセルが出た際にお知らせすることができます（先着順のためご案内をお約束するものではありません）。')}</div>
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                          <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')}
                            style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--input-bg)', color:'var(--text)' }} />
                        </div>
                        {wlErr && <div style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                          <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                          <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                        </label>
                        {!privacyConsent && (
                          <div style={{ fontSize:11, color:'var(--warn-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          <button onClick={() => joinWaitlist(chgDate, effectiveChgGuests)} disabled={wlSubmitting || !privacyConsent}
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
                            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('お名前')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('電話番号')}
                              style={{ flex:'1 1 140px', minHeight:44, boxSizing:'border-box', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:6, fontSize:13, background:'var(--white)', color:'var(--text)' }} />
                          </div>
                        )}
                        {wlErr && <div style={{ color:'var(--red)', marginBottom:8 }}>{wlErr}</div>}
                        {featureFlags.waitlistEnabled && (
                          <>
                            <label style={{ display:'flex', alignItems:'flex-start', gap:6, fontSize:11, color:'var(--sub)', marginBottom:8, cursor:'pointer' }}>
                              <input type="checkbox" checked={privacyConsent} onChange={(e) => setPrivacyConsent(e.target.checked)} style={{ marginTop:2 }} />
                              <span>{t('ご入力いただいた情報の取り扱い（')}<a href="/privacy" target="_blank" rel="noopener noreferrer" onClick={openPrivacyLink} style={{ color:'var(--info-text)', textDecoration:'underline' }}>{t('こちら')}</a>{t('）に同意します')}</span>
                            </label>
                            {!privacyConsent && (
                              <div style={{ fontSize:11, color:'var(--warn-text)', marginBottom:8 }}>{t('上記の同意チェックが必要です')}</div>
                            )}
                          </>
                        )}
                        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                          {featureFlags.waitlistEnabled && (
                            <button onClick={() => joinWaitlist(chgDate, effectiveChgGuests)} disabled={wlSubmitting || !privacyConsent}
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
            <div className="card-lbl">{t('💬　伝言・要望（任意）')}</div>
            <div className="card-body">
              <textarea rows={3} value={chgMsg} onChange={(e) => setChgMsg(e.target.value)}
                placeholder={t('変更に際してのご要望や伝言があればご記入ください')} />
            </div>
          </div>
          <div className="mt16">
            <button className="btn-p" onClick={() => {
              if (!chgDate) { setChgErr(t('新しいご来店日を選択してください')); return scrollToCard('card-chg-date') }
              if (deadlinePassed(chgDate)) { setChgErr(t('選択された日付は予約受付期限を過ぎています')); return scrollToCard('card-chg-date') }
              if (!chgTime) { setChgErr(t('新しい来店時間を選択してください')); return scrollToCard('card-chg-time') }
              if (guestCountEnabled && !chgGuests) { setChgErr(t('人数を選択してください')); return scrollToCard('card-chg-guest') }
              setChgErr('')
              setScreen('chgconfirm')
            }}>{t('確認へ')}</button>
            <div className="mt8">
              <button className="btn-s" onClick={() => { setAvail(null); setAvailErr(''); setScreen('myres') }}>{t('← 戻る')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE CONFIRM ── */}
      {screen === 'chgconfirm' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">{t('🔄　変更内容の確認')}</div>
            <div className="cf-row">
              <div className="cf-lbl">{t('変更前')}</div>
              <div className="cf-val" style={{ color: 'var(--sub)' }}>
                {fmtDateLang(changingRes?.date, lang)}<br />{fmtTime(changingRes?.time)}〜{fmtTime(changingRes?.endTime)}　{guestsDisplay(changingRes?.guests)}
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">{t('変更後')}</div>
              <div className="cf-val acc">
                {fmtDateLang(chgDate, lang)}　{chgTime}〜{addMin(chgTime, chgStayMin)}　{effectiveChgGuests}{t('名様')}
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
          {chgcfErr && <div className="err mt12">{chgcfErr}</div>}
          <div className="mt16">
            <button className="btn-p" disabled={chgSubmitting} onClick={submitChange}>
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
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:500, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
          <div style={{ background:'var(--white)', borderRadius:'16px 16px 0 0', padding:'24px 20px 36px', width:'100%', maxWidth:480, maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <h2 style={{ fontSize:16, fontWeight:'bold', color:'var(--text)' }}>{t('⚠️ ご予約にあたっての注意事項')}</h2>
              <button onClick={() => setShowNotesPopup(false)} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'var(--hint)' }}>✕</button>
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
          --border: #e0e0e0;
          --red: #e53935;
          --info-bg: #eef7ff;
          --info-border: #bcdcfb;
          --info-text: #2c5a80;
          --warn-bg: #fff8e6;
          --warn-border: #f5d78e;
          --warn-text: #8a6d1f;
          --input-bg: #fafafa;
          --input-focus-bg: #fff;
          --danger-bg: #fff0f0;
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
            --border: #333;
            --red: #ff6b6b;
            --sat-blue: #6fa8dc;
            --info-bg: #16232d;
            --info-border: #2c5a80;
            --info-text: #8ec4ee;
            --warn-bg: #2b2410;
            --warn-border: #8a6d1f;
            --warn-text: #f0d27a;
            --input-bg: #2a2a2a;
            --input-focus-bg: #333;
            --danger-bg: #3a1f1f;
            --danger-border: #6b3030;
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
        .cf-lbl { font-size: 12px; color: var(--sub); min-width: 72px; padding-top: 2px; white-space: nowrap; }
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
        .hint { font-size: 11px; color: var(--hint); margin-top: 7px; line-height: 1.6; }
        .deadline-note { font-size: 13px; font-weight: bold; color: var(--deadline-text); margin-top: 7px; line-height: 1.6; }
        .optional-toggle {
          width: 100%; text-align: left; background: transparent; border: 1.5px dashed var(--border);
          border-radius: 12px; padding: 13px 16px; margin-bottom: 14px; font-size: 13px; color: var(--sub);
          cursor: pointer;
        }
        .card-lbl-optional { font-size: 12px; font-weight: bold; color: var(--sub); padding: 11px 16px 9px; border-bottom: 1px solid var(--border); letter-spacing: 0.5px; }
      `}</style>
    </>
  )
}
