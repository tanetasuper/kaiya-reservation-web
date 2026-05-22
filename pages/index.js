import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Head from 'next/head'
import Script from 'next/script'
import { api } from '../lib/api'

const LIFF_ID = '2010107032-v35Ka2mS'
const TIME_SLOTS = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00']
const STAY_MIN = 150

function addMin(t, m) {
  const [h, mn] = t.split(':').map(Number)
  const tot = h * 60 + mn + m
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`
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
  const list = slots && slots.length > 0 ? slots : TIME_SLOTS
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
function CustomerCalendar({ year, month, monthAvail, dateMin, dateMax, selected, onSelect, onPrev, onNext, loading }) {
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
    if (isDisabled) return { text: info.status === 'blocked' || info.status === 'full' ? '✕' : '', color:'#ddd' }
    if (info.status === 'few')  return { text:'△', color:'#e65100' }
    if (info.status === 'open') return { text:'○', color:'#2e7d32' }
    return { text:'', color:'transparent' }
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <button onClick={onPrev} style={{ padding:'6px 14px', background:'#f0f0f0', border:'none', borderRadius:8, fontSize:15, cursor:'pointer', color:'#555' }}>←</button>
        <span style={{ fontWeight:'bold', fontSize:15 }}>{year}年{month+1}月</span>
        <button onClick={onNext} style={{ padding:'6px 14px', background:'#f0f0f0', border:'none', borderRadius:8, fontSize:15, cursor:'pointer', color:'#555' }}>→</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:4 }}>
        {CAL_WEEK.map((w,i) => (
          <div key={w} style={{ textAlign:'center', fontSize:11, fontWeight:'bold', padding:'3px 0',
            color: i===0?'#e53935':i===6?'#1565c0':'#888' }}>{w}</div>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign:'center', padding:'20px 0', color:'#aaa', fontSize:13 }}>読み込み中...</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
          {cells.map((cell, i) => {
            if (cell === null) return <div key={`e${i}`}/>
            const mk = mark(cell.info, cell.isDisabled)
            const colIdx = i % 7
            return (
              <button key={cell.ymd} disabled={cell.isDisabled}
                onClick={() => onSelect(cell.isSelected ? '' : cell.ymd)}
                style={{
                  padding:'3px 2px', textAlign:'center', fontSize:12,
                  border: cell.isSelected ? '2px solid #06c755' : cell.isToday ? '2px solid #aaa' : '1px solid transparent',
                  borderRadius:6,
                  background: cell.isSelected ? '#f0fff4' : 'transparent',
                  color: cell.isDisabled ? '#ccc' : colIdx===0 ? '#e53935' : colIdx===6 ? '#1565c0' : '#111',
                  cursor: cell.isDisabled ? 'default' : 'pointer',
                  minHeight:42, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                }}>
                <span style={{ fontWeight: cell.isToday?'bold':'normal', lineHeight:1.2 }}>{cell.d}</span>
                <span style={{ fontSize:10, color:mk.color, lineHeight:1 }}>{mk.text}</span>
              </button>
            )
          })}
        </div>
      )}
      <div style={{ display:'flex', gap:14, marginTop:8, fontSize:11, flexWrap:'wrap' }}>
        <span style={{ color:'#2e7d32' }}>○ 空きあり</span>
        <span style={{ color:'#e65100' }}>△ 残席わずか</span>
        <span style={{ color:'#e53935' }}>✕ 満席/休業</span>
      </div>
    </div>
  )
}

export default function Home() {
  const [screen, setScreen] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [dateMin, setDateMin] = useState('')
  const [dateMax, setDateMax] = useState('')

  // 祝日データ（初回日付選択時に取得）
  const [holidays, setHolidays] = useState({})
  const holidaysFetchedRef = useRef(false)

  // 空席情報
  const [avail, setAvail] = useState(null)
  const [availLoading, setAvailLoading] = useState(false)

  // コース設定（管理画面から取得）
  const [settingsCourses, setSettingsCourses] = useState([{ name:'季節の貝フルコース', price:11000, description:'旬の貝と野菜をふんだんに使ったコースメニュー', duration:150, mealType:'dinner' }])
  const [selCourse, setSelCourse] = useState(0)
  const [settingsTimeRanges, setSettingsTimeRanges] = useState([
    { type:'lunch', label:'ランチ', start:'11:30', end:'14:00' },
    { type:'dinner', label:'ディナー', start:'17:00', end:'21:00' },
  ])
  const [bookingNotes, setBookingNotes] = useState('')
  const [showNotesPopup, setShowNotesPopup] = useState(false)
  const defCutoff = { daysBefore:2, time:'22:00' }
  const [settingsCutoffRules, setSettingsCutoffRules] = useState({
    '0':{ daysBefore:3, time:'22:00' }, '1':defCutoff, '2':defCutoff,
    '3':defCutoff, '4':defCutoff, '5':defCutoff,
    '6':{ daysBefore:2, time:'22:00' }, 'holiday':{ daysBefore:3, time:'22:00' },
  })

  // 月別カレンダー
  const [calYear,          setCalYear]          = useState(new Date().getFullYear())
  const [calMonth,         setCalMonth]         = useState(new Date().getMonth())
  const [monthAvail,       setMonthAvail]       = useState({})
  const [monthAvailLoading,setMonthAvailLoading]= useState(false)

  // 予約フォーム
  const [selDate, setSelDate] = useState('')
  const [selGuest, setSelGuest] = useState('')
  const [selCount, setSelCount] = useState('')
  const [selTime, setSelTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [q1, setQ1] = useState('')
  const [q2, setQ2] = useState('')
  const [q3, setQ3] = useState('')
  const [notes, setNotes] = useState('')
  const [inputErr, setInputErr] = useState('')
  const [cfErr, setCfErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState({ detail: '', id: '', pending: false, error: '', backScreen: 'confirm', title: 'ご予約を承りました' })

  // 予約一覧
  const [myRes, setMyRes] = useState([])
  const [myResLoading, setMyResLoading] = useState(false)
  const [cancelId, setCancelId] = useState(null)
  const [cancelingId, setCancelingId] = useState(null)

  // 変更フォーム
  const [changingRes, setChangingRes] = useState(null)
  const [chgDate, setChgDate] = useState('')
  const [chgTime, setChgTime] = useState('')
  const [chgMsg, setChgMsg] = useState('')
  const [chgErr, setChgErr] = useState('')
  const [chgcfErr, setChgcfErr] = useState('')
  const [chgSubmitting, setChgSubmitting] = useState(false)

  const isKasshiki = selGuest === 'kasshiki' || selGuest === 'konsult'
  const effectiveGuests = isKasshiki ? selCount : selGuest
  const showTimeCard = selDate && selGuest && (!isKasshiki || selCount)

  // ===== 月別空席取得 =====
  async function fetchMonthAvail(year, month) {
    setMonthAvailLoading(true)
    try {
      const r = await api.getMonthAvailability(year, month + 1)
      setMonthAvail(r.dates || {})
    } catch { setMonthAvail({}) }
    setMonthAvailLoading(false)
  }

  // ===== コース × 時間帯 → 選択可能スロット / 所要時間 =====
  const visibleCourses = useMemo(() => settingsCourses.filter(c => !c.discontinued), [settingsCourses])
  const selStayMin = visibleCourses[selCourse]?.duration || STAY_MIN
  const courseTimeSlots = useMemo(() => {
    const mealType = visibleCourses[selCourse]?.mealType || 'dinner'
    const ranges = settingsTimeRanges.filter(tr =>
      mealType === 'both' || tr.type === mealType || tr.type === 'both'
    )
    if (!ranges.length) return TIME_SLOTS
    const all = []
    ranges.forEach(tr => generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) }))
    return all.sort()
  }, [visibleCourses, selCourse, settingsTimeRanges])

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
    if (!avail || availLoading) return false
    if (n === 1) return !avail.canBook1
    if (n >= 2 && n <= 5) return n > avail.remainingSeats
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
    if (n >= 2 && n <= 5 && n > avail.remainingSeats) return `${n}名\n満席`
    return `${n}名`
  }

  // ===== 空席取得 =====
  async function fetchAvailability(date) {
    if (!date) return
    setAvailLoading(true)
    setAvail(null)
    try {
      const r = await api.getAvailability(date)
      setAvail(r)
    } catch {
      setAvail(null)
    }
    setAvailLoading(false)
  }

  // ===== 祝日取得（初回のみ）=====
  async function ensureHolidays() {
    if (holidaysFetchedRef.current) return
    holidaysFetchedRef.current = true
    try {
      const r = await fetch('https://holidays-jp.github.io/api/v1/date.json')
      const data = await r.json()
      setHolidays(data || {})
    } catch {
      setHolidays({})
    }
  }

  // ===== 日付変更ハンドラ =====
  async function onDateChange(d) {
    setSelDate(d)
    setSelTime('')
    setSelGuest('')
    setSelCount('')
    setAvail(null)
    setInputErr('')
    if (d) {
      await ensureHolidays()
      fetchAvailability(d)
    }
  }

  // ===== LIFF初期化 =====
  const initLiff = useCallback(async () => {
    let userId = null
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
            if (cp.name) setName(String(cp.name))
            if (cp.phone) setPhone(String(cp.phone))
          }
        }).catch(() => {})
      } else {
        window.liff.login({ redirectUri: location.href })
        return
      }
    } catch (e) {
      console.warn('LIFF:', e.message)
      const guestId = 'guest_' + Date.now()
      setProfile({ userId: guestId, displayName: '' })
      userId = guestId
    }
    // URLパラメータ ?screen=myres で予約確認画面に直接遷移
    const goMyRes = new URLSearchParams(window.location.search).get('screen') === 'myres'
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

  useEffect(() => {
    const now = new Date()
    setDateMin(computeDateMin(now, {}))
    const mx = new Date(now)
    mx.setFullYear(mx.getFullYear() + 1)
    setDateMax(toYMD(mx))
    // コース・時間帯設定を取得
    api.getSettings().then(r => {
      if (!r.success) return
      if (r.courses && r.courses.length > 0) { setSettingsCourses(r.courses); setSelCourse(0) }
      if (r.timeRanges && r.timeRanges.length > 0) setSettingsTimeRanges(r.timeRanges)
      if (r.cutoffRules) setSettingsCutoffRules(r.cutoffRules)
      if (r.bookingNotes) setBookingNotes(r.bookingNotes)
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
  function goConfirm() {
    if (!selDate) return setInputErr('ご来店日を選択してください')
    if (!selGuest) return setInputErr('人数を選択してください')
    if (isKasshiki && !selCount) return setInputErr('人数を選択してください')
    if (!selTime) return setInputErr('来店時間を選択してください')
    if (!String(name).trim()) return setInputErr('お名前を入力してください')
    if (!String(phone).trim()) return setInputErr('電話番号を入力してください')
    // 残席チェック
    if (avail && !isKasshiki) {
      const n = parseInt(selGuest) || 0
      if (n >= 2 && n > avail.remainingSeats)
        return setInputErr(`残席${avail.remainingSeats}名のため、${n}名様のご予約はお受けできません`)
      if (n === 1 && !avail.canBook1)
        return setInputErr('1名様のご予約はこの日はお受けできません')
    }
    setInputErr('')
    if (bookingNotes) {
      setShowNotesPopup(true)
    } else {
      setScreen('confirm')
    }
  }

  // ===== 予約送信 =====
  async function submitReservation() {
    setSubmitting(true)
    setCfErr('')
    const d = parseDate(selDate)
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    const isKonsult = selGuest === 'konsult'
    const baseDetail = `${fmtDate(selDate)}　${selTime}〜${addMin(selTime, selStayMin)}\n${effectiveGuests}名様${isKasshiki ? '（貸切プラン）' : ''}`
    // Optimistic UI：先に done 画面へ遷移し、API はバックグラウンドで送信
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'confirm', title: 'ご予約を承りました' })
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
        guests: effectiveGuests,
        course: visibleCourses[selCourse]?.name || '季節の貝フルコース',
        isKasshiki: isKasshiki && !isKonsult,
        isKonsult,
        notes: String(notes).trim(),
        q1: String(q1).trim(),
        q2: String(q2).trim(),
        q3: String(q3).trim(),
      })
      if (r.success) {
        setDone({ detail: baseDetail + '\n\nLINEに確認メッセージをお送りしました。', id: `予約番号：${r.reservationId}`, pending: false, error: '', backScreen: 'confirm', title: 'ご予約を承りました' })
      } else {
        setDone(prev => ({ ...prev, pending: false, error: r.error || '予約に失敗しました' }))
      }
    } catch (e) {
      setDone(prev => ({ ...prev, pending: false, error: '通信エラーが発生しました: ' + (e?.message || '') }))
    }
    setSubmitting(false)
  }

  // ===== 予約一覧 =====
  async function openMyRes() {
    await ensureHolidays()
    setMyRes([])
    setMyResLoading(true)
    setCancelId(null)
    setScreen('myres')
    try {
      const r = await api.getMyReservations(profile?.userId || '')
      setMyRes(r.success ? r.list || [] : [])
    } catch {
      setMyRes([])
    }
    setMyResLoading(false)
  }

  async function execCancel(id) {
    setCancelingId(id)
    try {
      const r = await api.cancelReservation({ reservationId: id, lineUserId: profile?.userId || '' })
      if (r.success) setMyRes((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'キャンセル' } : x)))
    } catch {}
    setCancelId(null)
    setCancelingId(null)
  }

  // ===== 変更フォーム =====
  function openChangeForm(res) {
    setChangingRes(res)
    setChgDate('')
    setChgTime('')
    setChgMsg('')
    setChgErr('')
    setScreen('change')
  }

  async function submitChange() {
    setChgSubmitting(true)
    setChgcfErr('')
    const d = parseDate(chgDate)
    const nd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    const baseDetail = `${fmtDate(chgDate)}　${chgTime}〜${addMin(chgTime, STAY_MIN)}`
    // Optimistic UI：先に done 画面へ遷移し、API はバックグラウンドで送信
    setDone({ detail: baseDetail, id: '', pending: true, error: '', backScreen: 'chgconfirm', title: '変更が完了しました' })
    setScreen('done')
    try {
      const r = await api.changeReservation({
        reservationId: changingRes.id,
        lineUserId: profile?.userId || '',
        newDate: nd,
        newTime: chgTime,
        message: chgMsg.trim(),
      })
      if (r.success) {
        setDone({ detail: baseDetail + '\n\nLINEに変更確認メッセージをお送りしました。', id: `予約番号：${changingRes.id}`, pending: false, error: '', backScreen: 'chgconfirm', title: '変更が完了しました' })
      } else {
        setDone(prev => ({ ...prev, pending: false, error: r.error || '変更に失敗しました' }))
      }
    } catch {
      setDone(prev => ({ ...prev, pending: false, error: '通信エラーが発生しました' }))
    }
    setChgSubmitting(false)
  }

  // ===== レンダリング =====
  return (
    <>
      <Head>
        <title>貝屋和光 ご予約</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </Head>

      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={initLiff}
        onError={() => {
          setProfile({ userId: 'guest_' + Date.now(), displayName: '' })
          setScreen('input')
        }}
      />

      <div className="header">
        <h1>貝 屋 和 光</h1>
        <p>築地 ／ 貝焼き専門店</p>
      </div>

      {/* ── LOADING ── */}
      {screen === 'loading' && (
        <div className="scr">
          <div className="ld-wrap">
            <div className="dots">
              <div className="dot" /><div className="dot" /><div className="dot" />
            </div>
            <p className="ld-txt">読み込み中...</p>
          </div>
        </div>
      )}

      {/* ── INPUT FORM ── */}
      {screen === 'input' && (
        <div className="scr">
          {/* コース */}
          <div className="card">
            <div className="card-lbl">🍽　コース</div>
            <div className="card-body">
              {visibleCourses.map((c, i) => (
                <div key={i}
                  className={`course-item${visibleCourses.length > 1 ? (selCourse === i ? ' sel' : '') : ''}`}
                  onClick={() => visibleCourses.length > 1 && setSelCourse(i)}
                  style={visibleCourses.length > 1 ? { cursor:'pointer', border: selCourse===i ? '2px solid #06c755' : '2px solid #e0e0e0', borderRadius:10, padding:'10px 12px', marginBottom: i < visibleCourses.length-1 ? 8 : 0 } : {}}>
                  <div className="course-row">
                    <div className="course-nm">{c.name}</div>
                    <div className="course-pr">¥{Number(c.price).toLocaleString()}<small>（税込）</small></div>
                  </div>
                  {c.description && <div className="course-dc">{c.description}</div>}
                  <div>
                    <span className="tag">約{Math.floor((c.duration||150)/60)}時間{(c.duration||150)%60 > 0 ? (c.duration||150)%60+'分' : ''}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 来店日 */}
          <div className="card">
            <div className="card-lbl">📅　ご来店日</div>
            <div className="card-body">
              <CustomerCalendar
                year={calYear} month={calMonth}
                monthAvail={monthAvail}
                dateMin={dateMin} dateMax={dateMax}
                selected={selDate}
                onSelect={(d) => onDateChange(d)}
                onPrev={() => { if (calMonth === 0) { setCalYear(y=>y-1); setCalMonth(11) } else setCalMonth(m=>m-1) }}
                onNext={() => { if (calMonth === 11) { setCalYear(y=>y+1); setCalMonth(0) } else setCalMonth(m=>m+1) }}
                loading={monthAvailLoading}
              />
              {selDate && <p className="hint" style={{ marginTop:10 }}>{deadlineLabel(selDate)}</p>}
            </div>
          </div>

          {/* 人数 */}
          <div className="card">
            <div className="card-lbl">
              👥　人数
              {availLoading && <span className="avail-loading"> 確認中...</span>}
              {avail && !availLoading && <span className="avail-info"> 残席 {avail.remainingSeats}名</span>}
            </div>
            <div className="card-body">
              <div className="g-row">
                {[1, 2, 3, 4, 5].map((n) => {
                  const disabled = guestDisabled(n)
                  const isOccupied = avail && !availLoading && disabled
                  return (
                    <button
                      key={n}
                      className={`g-btn${selGuest === String(n) ? ' sel' : ''}${disabled ? ' dis' : ''}`}
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return
                        setSelGuest(String(n))
                        setSelCount('')
                        setSelTime('')
                        setInputErr('')
                      }}
                    >
                      <span className="g-btn-main">{n}名</span>
                      {isOccupied && <span className="g-btn-sub">{n === 1 ? '条件あり' : '満席'}</span>}
                    </button>
                  )
                })}
              </div>

              {/* 貸切 6〜8名 */}
              <button
                className={`g-btn-k${selGuest === 'kasshiki' ? ' sel' : ''}${kasshikiDisabled() ? ' dis' : ''}`}
                disabled={kasshikiDisabled()}
                onClick={() => {
                  if (kasshikiDisabled()) return
                  setSelGuest('kasshiki')
                  setSelCount('')
                  setSelTime('')
                  setInputErr('')
                }}
              >
                {kasshikiDisabled() && avail
                  ? '🔒 貸切プラン（6〜8名）— 本日は受付不可'
                  : '🔒 貸切プラン（6〜8名）'}
              </button>
              {selGuest === 'kasshiki' && (
                <div className="k-panel">
                  <p className="k-note">
                    ご利用日に他のご予約がない場合のみ貸切でのご案内が可能です。
                    <br />予約確定後にスタッフよりLINEにてご連絡いたします。
                  </p>
                  <div className="c-row">
                    {['6', '7', '8'].map((n) => (
                      <button key={n} className={`c-btn${selCount === n ? ' sel' : ''}`}
                        onClick={() => { setSelCount(n); setSelTime(''); setInputErr('') }}>
                        {n}名
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 貸切要相談 9〜12名 */}
              <button
                className={`g-btn-k konsult${selGuest === 'konsult' ? ' sel' : ''}${konsultDisabled() ? ' dis' : ''}`}
                disabled={konsultDisabled()}
                onClick={() => {
                  if (konsultDisabled()) return
                  setSelGuest('konsult')
                  setSelCount('')
                  setSelTime('')
                  setInputErr('')
                }}
              >
                {konsultDisabled() && avail
                  ? '💬 貸切要相談（9〜12名）— 本日は受付不可'
                  : '💬 貸切要相談（9〜12名）'}
              </button>
              {selGuest === 'konsult' && (
                <div className="k-panel">
                  <p className="k-note">
                    9〜12名様はご相談の上でのご案内となります。
                    <br />予約後にスタッフよりLINEにてご連絡いたします。
                  </p>
                  <div className="c-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    {['9', '10', '11', '12'].map((n) => (
                      <button key={n} className={`c-btn${selCount === n ? ' sel' : ''}`}
                        onClick={() => { setSelCount(n); setSelTime(''); setInputErr('') }}>
                        {n}名
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 来店時間 */}
          {showTimeCard && (
            <div className="card">
              <div className="card-lbl">⏰　来店時間</div>
              <div className="card-body">
                <TimeGrid value={selTime} onChange={(s) => { setSelTime(s); setInputErr('') }} slots={courseTimeSlots} />
                <p className="hint">
                  {courseTimeSlots.length > 0
                    ? `受付時間 ${courseTimeSlots[0]}〜${courseTimeSlots[courseTimeSlots.length-1]}（コースは約${Math.floor(selStayMin/60)}時間${selStayMin%60>0?selStayMin%60+'分':''}）`
                    : ''}
                </p>
              </div>
            </div>
          )}

          {/* 連絡先 */}
          <div className="card">
            <div className="card-lbl">📝　ご連絡先</div>
            <div className="card-body">
              <input type="text" value={name}
                onChange={(e) => { setName(e.target.value); setInputErr('') }}
                placeholder="お名前（例：山田 太郎）" />
              <input type="tel" value={phone}
                onChange={(e) => { setPhone(e.target.value); setInputErr('') }}
                placeholder="電話番号（例：090-0000-0000）"
                style={{ marginTop: 10 }} />
            </div>
          </div>

          {/* Q1 */}
          <div className="card">
            <div className="card-lbl">❓　Q1. ご利用目的（任意）</div>
            <div className="card-body">
              <textarea rows={2} value={q1} onChange={(e) => setQ1(e.target.value)}
                placeholder="例：誕生日、記念日、接待など" />
            </div>
          </div>

          {/* Q2 */}
          <div className="card">
            <div className="card-lbl">❓　Q2. 同伴者のご関係性（任意）</div>
            <div className="card-body">
              <textarea rows={2} value={q2} onChange={(e) => setQ2(e.target.value)}
                placeholder="例：恋人、家族、友人、同僚など" />
            </div>
          </div>

          {/* Q3 */}
          <div className="card">
            <div className="card-lbl">❓　Q3. どのように当店を知りましたか（任意）</div>
            <div className="card-body">
              <textarea rows={2} value={q3} onChange={(e) => setQ3(e.target.value)}
                placeholder="例：Instagram、食べログ、知人の紹介など" />
            </div>
          </div>

          {/* ご要望 */}
          <div className="card">
            <div className="card-lbl">💬　ご要望（任意）</div>
            <div className="card-body">
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="アレルギーなど" />
            </div>
          </div>

          {inputErr && <div className="err mt12">{inputErr}</div>}
          <div className="mt16">
            <button className="btn-p" onClick={goConfirm}>確認画面へ　→</button>
          </div>
          <div className="mt8">
            <button className="myres-link" onClick={openMyRes}>ご予約の確認・変更はこちら</button>
          </div>
        </div>
      )}

      {/* ── CONFIRM ── */}
      {screen === 'confirm' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">✅　ご予約内容の確認</div>
            <div className="cf-row">
              <div className="cf-lbl">コース</div>
              <div className="cf-val">
                {visibleCourses[selCourse]?.name || '季節の貝フルコース'}
                <br />
                <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--sub)' }}>
                  ¥{Number(visibleCourses[selCourse]?.price || 11000).toLocaleString()}（税込）/ お一人様　・　約{Math.floor((visibleCourses[selCourse]?.duration||150)/60)}時間{(visibleCourses[selCourse]?.duration||150)%60 > 0 ? (visibleCourses[selCourse]?.duration||150)%60+'分' : ''}
                </span>
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">ご来店日</div>
              <div className="cf-val">{fmtDate(selDate)}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">時間</div>
              <div className="cf-val">{selTime}〜{addMin(selTime, selStayMin)}（目安）</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">人数</div>
              <div className="cf-val">{effectiveGuests}名様</div>
            </div>
            {isKasshiki && (
              <div className="cf-row">
                <div className="cf-lbl">プラン</div>
                <div className="cf-val acc">
                  {selGuest === 'konsult' ? '💬 貸切要相談' : '🔒 貸切プラン'}
                </div>
              </div>
            )}
            <div className="cf-row">
              <div className="cf-lbl">お名前</div>
              <div className="cf-val">{name} 様</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">電話番号</div>
              <div className="cf-val">{phone}</div>
            </div>
            {q1.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">Q1</div>
                <div className="cf-val">{q1.trim()}</div>
              </div>
            )}
            {q2.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">Q2</div>
                <div className="cf-val">{q2.trim()}</div>
              </div>
            )}
            {q3.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">Q3</div>
                <div className="cf-val">{q3.trim()}</div>
              </div>
            )}
            {notes.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">ご要望</div>
                <div className="cf-val">{notes.trim()}</div>
              </div>
            )}
          </div>
          {bookingNotes ? (
            <div className="policy" style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setShowNotesPopup(true)}>
              <span style={{ fontSize:16 }}>⚠️</span>
              <span>注意事項・キャンセルポリシーを確認する（タップで再表示）</span>
            </div>
          ) : null}
          {cfErr && <div className="err mt12">{cfErr}</div>}
          <div className="mt16">
            <button className="btn-p" disabled={submitting} onClick={submitReservation}>
              {submitting ? '送信中...' : '予約を確定する'}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('input')}>← 入力画面に戻る</button>
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
                <p className="ld-txt">送信中です...</p>
              </div>
            ) : done.error ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
                <div className="done-ttl" style={{ color: 'var(--red)' }}>エラーが発生しました</div>
                <div className="done-sub">{done.error}</div>
                <div className="mt16">
                  <button className="btn-s" onClick={() => { setScreen(done.backScreen); setSubmitting(false); setChgSubmitting(false) }}>← 戻る</button>
                </div>
              </>
            ) : (
              <>
                <div className="done-ck">✓</div>
                <div className="done-ttl">{done.title}</div>
                <div className="done-sub" style={{ whiteSpace: 'pre-line' }}>{done.detail}</div>
                <div className="done-id">{done.id}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MY RESERVATIONS ── */}
      {screen === 'myres' && (
        <div className="scr">
          {myResLoading ? (
            <div className="card">
              <div className="card-body" style={{ textAlign: 'center', padding: 30 }}>
                <div className="dots">
                  <div className="dot" /><div className="dot" /><div className="dot" />
                </div>
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--hint)' }}>予約を確認中...</p>
              </div>
            </div>
          ) : myRes.length === 0 ? (
            <div className="no-res">現在、確定しているご予約はございません。</div>
          ) : (
            myRes.map((res) => (
              <div key={res.id} className="res-card">
                <div className="res-date">{fmtDate(res.date)}</div>
                <div className="res-detail">
                  ⏰ {fmtTime(res.time)}〜{fmtTime(res.endTime)}　👥 {res.guests}名様
                  <br />🍽 {res.course}
                  {res.notes ? <><br />💬 {res.notes}</> : null}
                </div>
                {res.status === 'キャンセル' ? (
                  <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 13, fontWeight: 'bold' }}>✕ キャンセル済み</div>
                ) : !isChangeCancelable(res.date) ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--hint)', lineHeight: 1.7 }}>
                    ※ 変更・キャンセルの受付期限が過ぎています。<br />
                    直前の変更は基本承っておりませんが、まずはお電話ください。<br />
                    📞 <a href="tel:08093911475" style={{ color: 'var(--green)', fontWeight: 'bold' }}>080-9391-1475</a>
                  </div>
                ) : (
                  <>
                    <div className="res-actions">
                      <button className="btn-chg" onClick={() => openChangeForm(res)}>日程・時間を変更</button>
                      <button className="btn-cnl" onClick={() => setCancelId(res.id)}>キャンセル</button>
                    </div>
                    {cancelId === res.id && (
                      <div className="cnl-confirm">
                        <p className="cnl-msg">本当にキャンセルしますか？</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" disabled={cancelingId === res.id} onClick={() => execCancel(res.id)}>
                            {cancelingId === res.id ? '処理中...' : 'はい'}
                          </button>
                          <button className="cnl-no" disabled={!!cancelingId} onClick={() => setCancelId(null)}>いいえ</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
          <div className="mt8">
            <button className="btn-s" onClick={() => setScreen('input')}>← 戻る</button>
          </div>
        </div>
      )}

      {/* ── CHANGE FORM ── */}
      {screen === 'change' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">📝　変更対象の予約</div>
            <div className="card-body">
              <div className="chg-current">
                <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 6 }}>{fmtDate(changingRes?.date)}</div>
                <div>⏰ {fmtTime(changingRes?.time)}〜{fmtTime(changingRes?.endTime)}</div>
                <div>👥 {changingRes?.guests}名様</div>
                {changingRes?.course && <div style={{ marginTop: 4 }}>🍽 {changingRes.course}</div>}
                {changingRes?.notes && <div style={{ marginTop: 4, color: '#888' }}>💬 {changingRes.notes}</div>}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-lbl">📅　新しいご来店日</div>
            <div className="card-body">
              <input type="date" value={chgDate} min={dateMin} max={dateMax}
                onChange={(e) => { setChgDate(e.target.value); setChgTime(''); setChgErr('') }} />
            </div>
          </div>
          {chgDate && (
            <div className="card">
              <div className="card-lbl">⏰　新しい来店時間</div>
              <div className="card-body">
                <TimeGrid value={chgTime} onChange={(s) => { setChgTime(s); setChgErr('') }} />
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-lbl">💬　伝言・要望（任意）</div>
            <div className="card-body">
              <textarea rows={3} value={chgMsg} onChange={(e) => setChgMsg(e.target.value)}
                placeholder="変更に際してのご要望や伝言があればご記入ください" />
            </div>
          </div>
          {chgErr && <div className="err mt12">{chgErr}</div>}
          <div className="mt16">
            <button className="btn-p" onClick={() => {
              if (!chgDate) return setChgErr('新しいご来店日を選択してください')
              if (deadlinePassed(chgDate)) return setChgErr('選択された日付は予約受付期限を過ぎています')
              if (!chgTime) return setChgErr('新しい来店時間を選択してください')
              setChgErr('')
              setScreen('chgconfirm')
            }}>確認へ</button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('myres')}>← 戻る</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHANGE CONFIRM ── */}
      {screen === 'chgconfirm' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">🔄　変更内容の確認</div>
            <div className="cf-row">
              <div className="cf-lbl">変更前</div>
              <div className="cf-val" style={{ color: 'var(--sub)' }}>
                {fmtDate(changingRes?.date)}<br />{fmtTime(changingRes?.time)}〜{fmtTime(changingRes?.endTime)}
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">変更後</div>
              <div className="cf-val acc">
                {fmtDate(chgDate)}　{chgTime}〜{addMin(chgTime, STAY_MIN)}
              </div>
            </div>
            {chgMsg.trim() && (
              <div className="cf-row">
                <div className="cf-lbl">伝言</div>
                <div className="cf-val">{chgMsg.trim()}</div>
              </div>
            )}
          </div>
          <div className="policy">
            ⚠️ {deadlineLabel(chgDate) || '変更後の予約日が受付期限を過ぎている場合はキャンセル料が発生することがあります。'}
          </div>
          {chgcfErr && <div className="err mt12">{chgcfErr}</div>}
          <div className="mt16">
            <button className="btn-p" disabled={chgSubmitting} onClick={submitChange}>
              {chgSubmitting ? '送信中...' : '変更を確定する'}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('change')}>← 戻る</button>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTES POPUP ── */}
      {showNotesPopup && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:500, display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
          <div style={{ background:'#fff', borderRadius:'16px 16px 0 0', padding:'24px 20px 36px', width:'100%', maxWidth:480, maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <h2 style={{ fontSize:16, fontWeight:'bold', color:'#111' }}>⚠️ ご予約にあたっての注意事項</h2>
              <button onClick={() => setShowNotesPopup(false)} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#aaa' }}>✕</button>
            </div>
            <div style={{ fontSize:13, color:'#444', lineHeight:1.9, whiteSpace:'pre-line', marginBottom:24 }}>
              {bookingNotes}
            </div>
            <button
              onClick={() => { setShowNotesPopup(false); setScreen('confirm') }}
              style={{ display:'block', width:'100%', padding:16, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:16, fontWeight:'bold', cursor:'pointer' }}>
              確認しました　→
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
        .tag { display: inline-block; background: #f0fff4; color: var(--green); font-size: 11px; border-radius: 4px; padding: 2px 7px; margin-top: 8px; }
        input[type='date'], input[type='text'], input[type='tel'], textarea {
          width: 100%; padding: 13px 14px; border: 1.5px solid var(--border); border-radius: 8px;
          font-size: 16px; font-family: inherit; color: var(--text); background: #fafafa;
          -webkit-appearance: none; transition: border-color 0.15s; box-sizing: border-box;
        }
        input:focus, textarea:focus { outline: none; border-color: var(--green); background: #fff; }
        textarea { resize: none; }
        .g-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; }
        .g-btn, .t-btn, .c-btn {
          padding: 10px 4px; border: 1.5px solid var(--border); border-radius: 8px;
          background: var(--white); font-size: 13px; font-weight: bold; color: var(--text);
          cursor: pointer; text-align: center; transition: all 0.15s;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
        }
        .g-btn-main { font-size: 13px; font-weight: bold; line-height: 1; }
        .g-btn-sub { font-size: 10px; font-weight: normal; color: var(--red); line-height: 1; }
        .g-btn.sel, .t-btn.sel, .c-btn.sel { background: var(--green); border-color: var(--green); color: #fff; }
        .g-btn.sel .g-btn-sub { color: rgba(255,255,255,0.8); }
        .g-btn.dis { opacity: 0.5; cursor: not-allowed; pointer-events: none; background: #f5f5f5; }
        .g-btn-k {
          width: 100%; margin-top: 8px; padding: 14px; border: 1.5px solid var(--border); border-radius: 8px;
          background: var(--white); font-size: 13px; font-weight: bold; color: var(--sub);
          cursor: pointer; text-align: center; transition: all 0.15s;
        }
        .g-btn-k.sel { background: var(--green); border-color: var(--green); color: #fff; }
        .g-btn-k.dis { opacity: 0.5; cursor: not-allowed; pointer-events: none; background: #f5f5f5; border-color: #ccc; color: #999; }
        .g-btn-k.konsult { border-color: #888; background: #f8f8f8; color: #444; }
        .g-btn-k.konsult.sel { background: #555; border-color: #555; color: #fff; }
        .k-panel { margin-top: 12px; padding: 12px 14px; background: #f0fff4; border: 1px solid #b2ecc8; border-radius: 8px; }
        .k-note { font-size: 12px; color: #2d7a4e; line-height: 1.7; margin-bottom: 10px; }
        .c-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .t-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
        .t-btn { padding: 14px 4px; }
        .btn-p { display: block; width: 100%; padding: 17px; background: var(--green); color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: bold; cursor: pointer; letter-spacing: 0.3px; transition: opacity 0.15s; }
        .btn-p:active:not(:disabled) { opacity: 0.8; }
        .btn-p:disabled { background: #ccc; cursor: not-allowed; }
        .btn-s { display: block; width: 100%; padding: 15px; background: var(--white); color: var(--sub); border: 1.5px solid var(--border); border-radius: 12px; font-size: 15px; cursor: pointer; }
        .myres-link { display: block; width: 100%; padding: 14px; background: var(--white); color: var(--green); border: 1.5px solid var(--green); border-radius: 12px; font-size: 14px; font-weight: bold; cursor: pointer; text-align: center; }
        .err { background: #fff0f0; border: 1px solid #ffcccc; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: var(--red); }
        .cf-row { display: flex; padding: 13px 16px; border-bottom: 1px solid var(--border); gap: 12px; align-items: flex-start; }
        .cf-row:last-child { border-bottom: none; }
        .cf-lbl { font-size: 12px; color: var(--sub); min-width: 72px; padding-top: 2px; white-space: nowrap; }
        .cf-val { font-size: 14px; font-weight: bold; flex: 1; line-height: 1.5; }
        .cf-val.acc { color: var(--green); }
        .policy { background: #fffbef; border: 1px solid #ffe082; border-radius: 8px; padding: 12px 14px; font-size: 12px; color: #6d5200; line-height: 1.7; }
        .done-card { background: var(--white); border-radius: 12px; padding: 36px 20px 32px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .done-ck { width: 72px; height: 72px; background: var(--green); border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 36px; color: #fff; }
        .done-ttl { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .done-sub { font-size: 13px; color: var(--sub); line-height: 1.8; }
        .done-id { font-size: 11px; color: var(--hint); margin-top: 12px; }
        .res-card { background: var(--white); border-radius: 12px; padding: 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .res-date { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
        .res-detail { font-size: 13px; color: var(--sub); line-height: 1.7; }
        .res-actions { display: flex; gap: 8px; margin-top: 12px; }
        .btn-chg { flex: 1; padding: 11px; background: #f0fff4; color: var(--green); border: 1.5px solid var(--green); border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; }
        .btn-cnl { flex: 1; padding: 11px; background: #fff0f0; color: var(--red); border: 1.5px solid #ffcccc; border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; }
        .cnl-confirm { background: #fff0f0; border: 1px solid #ffcccc; border-radius: 8px; padding: 12px 14px; margin-top: 10px; }
        .cnl-msg { font-size: 13px; color: var(--red); margin-bottom: 10px; }
        .cnl-btns { display: flex; gap: 8px; }
        .cnl-yes { flex: 1; padding: 11px; background: var(--red); color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: bold; cursor: pointer; }
        .cnl-no { flex: 1; padding: 11px; background: var(--white); color: var(--sub); border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; cursor: pointer; }
        .no-res { text-align: center; padding: 40px 20px; color: var(--hint); font-size: 14px; }
        .chg-current { background: #f8f8f8; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: var(--sub); line-height: 1.8; }
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
      `}</style>
    </>
  )
}
