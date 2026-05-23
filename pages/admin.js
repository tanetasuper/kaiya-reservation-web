import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import Script from 'next/script'
import { api } from '../lib/api'

const TIME_SLOTS = ['17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00']

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
const STATUSES   = ['確定','キャンセル','カレンダー削除']
const SOURCES    = ['電話','食べログ','LINE','ウォークイン','その他']
const GUESTS     = ['1','2','3','4','5','6','7','8']
const WEEK       = ['日','月','火','水','木','金','土']

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function ymdSlash(s) {
  return s ? s.replace(/-/g,'/') : ''
}
function fmtDate(ymd) {
  if (!ymd) return ''
  const d = new Date(ymd.replace(/\//g,'-')+'T00:00:00')
  return `${d.getMonth()+1}/${d.getDate()}（${WEEK[d.getDay()]}）`
}
function formatTime(val) {
  if (!val) return ''
  const s = String(val)
  if (/^\d{1,2}:\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (!isNaN(d.getTime())) return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')
  return s
}
function statusStyle(s) {
  if (s==='確定')       return { background:'#e8f5e9', color:'#2e7d32' }
  if (s==='キャンセル') return { background:'#ffebee', color:'#c62828' }
  return { background:'#fff3e0', color:'#e65100' }
}
function notifLabel(type) {
  if (type==='new')    return { text:'新規予約', bg:'#e8f5e9', color:'#2e7d32' }
  if (type==='change') return { text:'変更',     bg:'#e3f2fd', color:'#1565c0' }
  if (type==='cancel') return { text:'キャンセル',bg:'#ffebee', color:'#c62828' }
  return { text: type, bg:'#f5f5f5', color:'#666' }
}
function fmtNotifDateTime(dt) {
  if (!dt) return ''
  const s = String(dt)
  const m = s.match(/(\d{4})\/(\d{2})\/(\d{2})\s(\d{2}):(\d{2})/)
  if (m) return `${parseInt(m[2])}/${parseInt(m[3])} ${m[4]}:${m[5]}`
  const d = new Date(s)
  if (!isNaN(d.getTime())) return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  return s
}

// ── xlsx helper (requires SheetJS CDN) ───────────────────────────
function dlXlsx(rows, sheetName, filename) {
  const XLSX = window.XLSX
  if (!XLSX) { alert('Excelライブラリが読み込まれていません。ページを再読み込みしてください。'); return }
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  const cols = rows.length > 0 ? Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length*2, 12) })) : []
  ws['!cols'] = cols
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// ── Shared UI ─────────────────────────────────────────────────────
function Toast({ msg, type }) {
  if (!msg) return null
  return (
    <div style={{
      position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
      background: type==='error' ? '#e53935' : '#06c755',
      color:'#fff', padding:'12px 24px', borderRadius:8,
      fontSize:14, fontWeight:'bold', zIndex:9999,
      boxShadow:'0 4px 12px rgba(0,0,0,.25)', whiteSpace:'nowrap',
    }}>{msg}</div>
  )
}
function Field({ label, children, span }) {
  return (
    <div style={span ? { gridColumn:'1/-1' } : {}}>
      <div style={{ fontSize:11, color:'#666', marginBottom:4 }}>{label}</div>
      {children}
    </div>
  )
}
const iStyle = {
  width:'100%', padding:'9px 12px',
  border:'1.5px solid #e0e0e0', borderRadius:8,
  fontSize:14, background:'#fafafa', fontFamily:'inherit',
  boxSizing:'border-box',
}
const sStyle = {
  ...iStyle, cursor:'pointer',
}
const btnGreen  = { padding:'9px 20px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:14, fontWeight:'bold', cursor:'pointer' }
const btnGray   = { padding:'9px 16px', background:'#f0f0f0', color:'#666', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }
const btnRed    = { padding:'6px 14px', background:'#ffebee', color:'#c62828', border:'none', borderRadius:6, fontSize:12, cursor:'pointer' }
const btnBlue   = { padding:'6px 12px', background:'#e3f2fd', color:'#1565c0', border:'none', borderRadius:6, fontSize:12, cursor:'pointer' }

// ── Calendar ──────────────────────────────────────────────────────
function AdminCalendar({ year, month, dayData, selected, onSelect }) {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const todayD      = new Date()
  const todayYMD    = `${todayD.getFullYear()}/${String(todayD.getMonth()+1).padStart(2,'0')}/${String(todayD.getDate()).padStart(2,'0')}`

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd  = `${year}/${String(month+1).padStart(2,'0')}/${String(d).padStart(2,'0')}`
    const info = dayData[ymd] || {}
    cells.push({ d, ymd, ...info, isToday: ymd===todayYMD, isSelected: ymd===selected })
  }

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
        {WEEK.map((dn,i) => (
          <div key={dn} style={{ textAlign:'center', fontSize:11, fontWeight:'bold', padding:'4px 0',
            color: i===0?'#e53935':i===6?'#1565c0':'#888' }}>{dn}</div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2 }}>
        {cells.map((cell,i) => cell===null ? <div key={`e${i}`}/> : (
          <button key={cell.ymd}
            onClick={() => onSelect(cell.isSelected ? null : cell.ymd)}
            style={{
              padding:'4px 2px', textAlign:'center', fontSize:12, cursor:'pointer',
              border: cell.isSelected ? '2px solid #1565c0' : cell.isToday ? '2px solid #06c755' : '1px solid transparent',
              borderRadius:6,
              background: cell.isBlocked ? '#ffebee' : cell.seatBlock ? '#fff3e0' : cell.isSelected ? '#e8eaf6' : 'transparent',
              color: cell.isBlocked ? '#e53935' : (i%7===0)?'#e53935':(i%7===6)?'#1565c0':'#111',
              minHeight:42, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start',
              paddingTop:4,
            }}>
            <span style={{ fontWeight: cell.isToday?'bold':'normal' }}>{cell.d}</span>
            {cell.count > 0 && (
              <span style={{ fontSize:9, background:'#06c755', color:'#fff', borderRadius:8,
                padding:'1px 4px', marginTop:2, lineHeight:1.4 }}>{cell.count}件</span>
            )}
            {cell.seatBlock && !cell.isBlocked && (
              <span style={{ fontSize:9, color:'#e65100', marginTop:1, lineHeight:1 }}>-{cell.seatBlock}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function CalNav({ year, month, onPrev, onNext }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
      <button onClick={onPrev} style={{ ...btnGray, padding:'6px 16px', fontSize:15 }}>←</button>
      <span style={{ fontWeight:'bold', fontSize:15 }}>{year}年{month+1}月</span>
      <button onClick={onNext} style={{ ...btnGray, padding:'6px 16px', fontSize:15 }}>→</button>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────
function EditModal({ res, onClose, onSaved, showToast, timeSlots }) {
  const [data, setData] = useState({
    name:   res.name,
    phone:  res.phone,
    date:   res.date.replace(/\//g,'-'),
    time:   formatTime(res.time) || '',
    guests: String(res.guests),
    course: res.course,
    notes:  res.notes || '',
    status: res.status,
    source: res.source || 'その他',
  })
  const [saving, setSaving] = useState(false)
  const set = k => e => setData(d => ({...d, [k]: e.target.value}))

  async function save() {
    setSaving(true)
    try {
      const r = await api.adminUpdateReservation({ id:res.id, ...data, date: data.date.replace(/-/g,'/') })
      if (r.success) { showToast('更新しました'); onSaved() }
      else showToast(r.error||'更新に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setSaving(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:16, padding:24, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ fontSize:16, fontWeight:'bold' }}>予約編集 <span style={{ fontSize:11, color:'#aaa', fontWeight:'normal' }}>{res.id}</span></h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888' }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Field label="お名前"><input type="text"   value={data.name}   style={iStyle} onChange={set('name')}   /></Field>
          <Field label="電話番号"><input type="tel"  value={data.phone}  style={iStyle} onChange={set('phone')}  /></Field>
          <Field label="来店日"> <input type="date"  value={data.date}   style={iStyle} onChange={set('date')}   /></Field>
          <Field label="時間">
            <select value={data.time} style={sStyle} onChange={set('time')}>
              {(timeSlots || TIME_SLOTS).map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="人数">
            <select value={data.guests} style={sStyle} onChange={set('guests')}>
              {GUESTS.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="ステータス">
            <select value={data.status} style={sStyle} onChange={set('status')}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="経路">
            <select value={data.source} style={sStyle} onChange={set('source')}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="メモ"><input type="text" value={data.notes} style={iStyle} onChange={set('notes')} /></Field>
        </div>
        <div style={{ display:'flex', gap:10, marginTop:18 }}>
          <button disabled={saving} onClick={save}
            style={{ flex:1, padding:14, background:'#06c755', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:'bold', cursor:'pointer' }}>
            {saving?'保存中...':'保存する'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, padding:14, background:'#f0f0f0', color:'#666', border:'none', borderRadius:10, fontSize:14, cursor:'pointer' }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Modal ─────────────────────────────────────────────────────
function AddModal({ initialDate, onClose, onAdded, showToast, timeSlots }) {
  const [data, setData] = useState({
    date: initialDate ? initialDate.replace(/\//g,'-') : '',
    time:'', name:'', phone:'', guests:'2',
    course:'季節の貝フルコース', notes:'', source:'電話',
    lineUserId:'', isKasshiki:false, forceAdd:false,
  })
  const [err, setErr]     = useState('')
  const [adding, setAdding] = useState(false)
  const set = k => e => setData(d => ({...d, [k]: e.target.value}))

  async function add() {
    if (!data.date||!data.time||!data.name||!data.phone) return setErr('日付・時間・名前・電話番号は必須です')
    setAdding(true); setErr('')
    try {
      const r = await api.adminAddReservation({...data, date: data.date.replace(/-/g,'/')})
      if (r.blocked && !data.forceAdd) {
        setErr('⚠️ '+r.reason+'\n「強制登録」にチェックして再送信してください。')
        setAdding(false); return
      }
      if (r.success) { showToast('登録しました（ID：'+r.id+'）'); onAdded() }
      else setErr(r.error||'登録に失敗しました')
    } catch { setErr('通信エラーが発生しました') }
    setAdding(false)
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:200,
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:16, padding:24, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ fontSize:16, fontWeight:'bold' }}>新規予約登録</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#888' }}>✕</button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Field label="来店日 *">  <input type="date" value={data.date} style={iStyle} onChange={set('date')} /></Field>
          <Field label="時間 *">
            <select value={data.time} style={sStyle} onChange={set('time')}>
              <option value="">-- 選択 --</option>
              {(timeSlots || TIME_SLOTS).map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="お名前 *">   <input type="text" value={data.name}  placeholder="山田 太郎"       style={iStyle} onChange={set('name')}  /></Field>
          <Field label="電話番号 *"> <input type="tel"  value={data.phone} placeholder="090-0000-0000"   style={iStyle} onChange={set('phone')} /></Field>
          <Field label="人数">
            <select value={data.guests} style={sStyle} onChange={set('guests')}>
              {GUESTS.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="経路">
            <select value={data.source} style={sStyle} onChange={set('source')}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="LINE UserID（任意）" span>
            <input type="text" value={data.lineUserId} placeholder="Uxxxxxxxx..." style={iStyle}
              onChange={set('lineUserId')} />
          </Field>
          <Field label="メモ（任意）" span>
            <input type="text" value={data.notes} placeholder="アレルギー・席希望など" style={iStyle} onChange={set('notes')} />
          </Field>
        </div>
        <div style={{ marginTop:12, display:'flex', gap:16 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={data.isKasshiki} onChange={e => setData(d=>({...d,isKasshiki:e.target.checked}))} />
            貸切プラン
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={data.forceAdd} onChange={e => setData(d=>({...d,forceAdd:e.target.checked}))} />
            強制登録（休業日を無視）
          </label>
        </div>
        {err && (
          <div style={{ marginTop:10, background:'#fff0f0', border:'1px solid #ffcccc', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#e53935', whiteSpace:'pre-line' }}>
            {err}
          </div>
        )}
        <button disabled={adding} onClick={add}
          style={{ marginTop:16, width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:'bold', cursor:'pointer' }}>
          {adding?'登録中...':'予約を登録する'}
        </button>
      </div>
    </div>
  )
}

// ── Main Admin ────────────────────────────────────────────────────
export default function Admin() {
  const [authed,       setAuthed]       = useState(false)
  const [loginPw,      setLoginPw]      = useState('')
  const [loginErr,     setLoginErr]     = useState('')
  const [loggingIn,    setLoggingIn]    = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryMsg,  setRecoveryMsg]  = useState({ text:'', ok:true })
  const [recovering,   setRecovering]   = useState(false)

  const [tab, setTab] = useState('reservations')
  const [toast,     setToast]     = useState({ msg:'', type:'ok' })

  // Calendar nav (shared)
  const [calYear,  setCalYear]  = useState(new Date().getFullYear())
  const [calMonth, setCalMonth] = useState(new Date().getMonth())

  // ── Reservations tab ────
  const [reservations,  setReservations]  = useState([])
  const [resLoading,    setResLoading]    = useState(false)
  const [selectedDate,  setSelectedDate]  = useState(null)
  const [editRes,       setEditRes]       = useState(null)
  const [cancelingResId, setCancelingResId] = useState(null)
  const [showAddModal,  setShowAddModal]  = useState(false)
  const [addInitDate,   setAddInitDate]   = useState(null)
  const [showSeatForm,  setShowSeatForm]  = useState(false)
  const [seatInput,     setSeatInput]     = useState({ seats:4, reason:'' })
  const [seatSaving,    setSeatSaving]    = useState(false)

  // ── Block tab ────
  const [blocked,       setBlocked]       = useState([])
  const [seatBlocks,    setSeatBlocks]    = useState([])
  const [blockLoading,  setBlockLoading]  = useState(false)
  const [closedDayAdding, setClosedDayAdding] = useState(false)

  // ── Notifications tab ────
  const [notifs,          setNotifs]          = useState([])
  const [notifLoading,    setNotifLoading]    = useState(false)
  const [selectedNotifIds,setSelectedNotifIds]= useState(new Set())
  // ── Settings tab ────
  const defCutoff = { daysBefore:2, time:'22:00' }
  const defCutoffRules = { '0':{ daysBefore:3, time:'22:00' }, '1':defCutoff, '2':defCutoff, '3':defCutoff, '4':defCutoff, '5':defCutoff, '6':{ daysBefore:2, time:'22:00' }, 'holiday':{ daysBefore:3, time:'22:00' } }
  const defTimeRanges = [{ type:'lunch', label:'ランチ', start:'11:30', end:'14:00' }, { type:'dinner', label:'ディナー', start:'17:00', end:'21:00' }]
  const [settings, setSettings] = useState({ maxSeats:8, courses:[], timeRanges: defTimeRanges, cutoffRules: defCutoffRules, bookingNotes:'' })
  const resCacheRef = useRef({})
  const [settingsLoading,setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving]  = useState(false)
  const [editCourseIdx,  setEditCourseIdx]   = useState(-1)
  const [editCourse,     setEditCourse]      = useState({})
  const [showAddCourse,  setShowAddCourse]   = useState(false)
  const [newCourse,      setNewCourse]       = useState({ name:'', price:'', description:'', duration:150, mealType:'dinner' })

  // ── Password change ────
  const [pwCurrent,   setPwCurrent]   = useState('')
  const [pwNew,       setPwNew]       = useState('')
  const [pwMsg,       setPwMsg]       = useState({ text:'', ok:true })
  const [pwChanging,  setPwChanging]  = useState(false)
  const [rcCurrent,        setRcCurrent]        = useState('')
  const [qaQuestion,       setQaQuestion]       = useState('')
  const [qaAnswer,         setQaAnswer]         = useState('')
  const [rcMsg,            setRcMsg]            = useState({ text:'', ok:true })
  const [rcChanging,       setRcChanging]       = useState(false)
  const [recoveryQuestion, setRecoveryQuestion] = useState('')
  const [loadingQuestion,  setLoadingQuestion]  = useState(false)

  // ── Data management ────
  const [custData,       setCustData]       = useState(null)
  const [custLoading,    setCustLoading]    = useState(false)
  const [allResData,     setAllResData]     = useState(null)
  const [allResLoading,  setAllResLoading]  = useState(false)
  const [allResDateFrom, setAllResDateFrom] = useState('')
  const [allResDateTo,   setAllResDateTo]   = useState('')

  function showToast(msg, type='ok') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg:'', type:'ok' }), 3000)
  }

  // ── Auth check on mount ────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('adminAuthed') === '1') {
      setAuthed(true)
    }
  }, [])

  async function doLogin() {
    if (!loginPw) return setLoginErr('パスワードを入力してください')
    setLoggingIn(true)
    setLoginErr('')
    try {
      const r = await api.checkAdminPassword(loginPw)
      if (r.success) {
        sessionStorage.setItem('adminAuthed', '1')
        setAuthed(true)
      } else {
        setLoginErr('パスワードが正しくありません')
      }
    } catch { setLoginErr('通信エラーが発生しました') }
    setLoggingIn(false)
  }

  function doLogout() {
    sessionStorage.removeItem('adminAuthed')
    setAuthed(false)
    setLoginPw('')
  }

  async function doRecovery() {
    if (!recoveryCode.trim()) return setRecoveryMsg({ text:'合言葉の答えを入力してください', ok:false })
    setRecovering(true)
    setRecoveryMsg({ text:'', ok:true })
    try {
      const r = await api.resetAdminPassword(recoveryCode.trim())
      if (r.success) {
        setRecoveryMsg({ text:'パスワードを「MV」にリセットしました。ログインしてください。', ok:true })
        setShowRecovery(false)
        setLoginPw('')
        setRecoveryCode('')
      } else {
        setRecoveryMsg({ text: r.error || '答えが正しくありません', ok:false })
      }
    } catch { setRecoveryMsg({ text:'通信エラーが発生しました', ok:false }) }
    setRecovering(false)
  }

  // ── Auto-load on mount / auth ───────────────────────────────────
  useEffect(() => {
    if (!authed) return
    loadBlocked()
    loadSeatBlocks()
    loadNotifications()
    loadSettings()
  }, [authed])

  useEffect(() => {
    if (!authed) return
    setSelectedDate(null)
    setShowSeatForm(false)
    loadReservations()
  }, [authed, calYear, calMonth])

  useEffect(() => {
    const block = selectedDate ? seatBlocks.find(sb => sb.date === selectedDate) || null : null
    if (block) setSeatInput({ seats: block.blockedSeats, reason: block.reason || '' })
    else { setSeatInput({ seats:4, reason:'' }); setShowSeatForm(false) }
  }, [selectedDate, seatBlocks])

  // ── Data loaders ────────────────────────────────────────────────
  async function loadReservations() {
    const y = calYear, m = calMonth
    const cacheKey = `${y}-${m}`
    const pad = n => String(n).padStart(2,'0')
    const lastD = new Date(y, m+1, 0).getDate()
    const filter = {
      dateFrom: `${y}/${pad(m+1)}/01`,
      dateTo:   `${y}/${pad(m+1)}/${pad(lastD)}`,
    }
    if (resCacheRef.current[cacheKey]) {
      setReservations(resCacheRef.current[cacheKey])
      return
    }
    setResLoading(true)
    try {
      const r = await api.adminGetReservations(filter)
      const list = r.list || []
      resCacheRef.current[cacheKey] = list
      setReservations(list)
      // Silently preload adjacent months
      ;[-1, 1].forEach(delta => {
        let pm = m + delta, py = y
        if (pm < 0) { pm = 11; py-- }
        if (pm > 11) { pm = 0; py++ }
        const key = `${py}-${pm}`
        if (resCacheRef.current[key] !== undefined) return
        const ld = new Date(py, pm+1, 0).getDate()
        api.adminGetReservations({ dateFrom:`${py}/${pad(pm+1)}/01`, dateTo:`${py}/${pad(pm+1)}/${pad(ld)}` })
          .then(rr => { if (resCacheRef.current[key] === undefined) resCacheRef.current[key] = rr.list || [] })
          .catch(() => {})
      })
    } catch { setReservations([]) }
    setResLoading(false)
  }

  function refreshRes() {
    delete resCacheRef.current[`${calYear}-${calMonth}`]
    loadReservations()
  }

  async function doRefreshAll() {
    resCacheRef.current = {}
    loadReservations()
    loadBlocked()
    loadSeatBlocks()
    loadNotifications()
  }

  async function loadBlocked() {
    setBlockLoading(true)
    try {
      const r = await api.adminGetBlockedDates()
      setBlocked(r.list || [])
    } catch { setBlocked([]) }
    setBlockLoading(false)
  }

  async function loadSeatBlocks() {
    try {
      const r = await api.adminGetSeatBlocks()
      setSeatBlocks(r.list || [])
    } catch { setSeatBlocks([]) }
  }

  async function loadNotifications() {
    setNotifLoading(true)
    try {
      const r = await api.adminGetNotifications()
      setNotifs(r.list || [])
    } catch { setNotifs([]) }
    setNotifLoading(false)
  }

  async function loadSettings() {
    setSettingsLoading(true)
    try {
      const r = await api.getSettings()
      if (r.success) {
        const tr = (r.timeRanges && r.timeRanges.length > 0) ? r.timeRanges : defTimeRanges
        setSettings({
          maxSeats: r.maxSeats||8,
          courses: r.courses||[],
          timeRanges: tr,
          cutoffRules: r.cutoffRules||defCutoffRules,
          bookingNotes: r.bookingNotes||'',
        })
      }
    } catch {}
    setSettingsLoading(false)
  }

  // ── Reservation actions ──────────────────────────────────────────
  async function cancelRes(id) {
    setCancelingResId(id)
    try {
      const r = await api.adminUpdateReservation({ id, status: 'キャンセル' })
      if (r.success) { showToast('キャンセルしました'); refreshRes() }
      else showToast(r.error||'キャンセルに失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setCancelingResId(null)
  }

  async function deleteRes(id) {
    setCancelingResId(id)
    try {
      const r = await api.adminDeleteReservation(id)
      if (r.success) { showToast('削除しました'); refreshRes() }
      else showToast(r.error||'削除に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setCancelingResId(null)
  }

  // ── Seat block for selected day ──────────────────────────────────
  async function saveSeatBlockForDay() {
    if (!selectedDate) return
    setSeatSaving(true)
    try {
      const r = await api.adminSetSeatBlock(selectedDate.replace(/\//g,'-'), seatInput.seats, seatInput.reason)
      if (r.success) { showToast('受付停止枠を設定しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setSeatSaving(false)
  }

  async function removeSeatBlockForDay() {
    if (!selectedDate) return
    setSeatSaving(true)
    try {
      const r = await api.adminRemoveSeatBlock(selectedDate.replace(/\//g,'-'))
      if (r.success) { showToast('受付停止枠を解除しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
    setSeatSaving(false)
  }

  async function removeClosedDay(date) {
    try {
      const r = await api.adminRemoveBlockedDate(date)
      if (r.success) { showToast('解除しました'); loadBlocked() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
  }

  // ── Notification actions ─────────────────────────────────────────
  async function markRead(id) {
    setNotifs(ns => ns.filter(n => n.id !== id))
    setSelectedNotifIds(prev => { const s = new Set(prev); s.delete(id); return s })
    try {
      const r = await api.adminMarkNotificationRead(id)
      if (!r.success) { showToast(r.error||'エラー','error'); loadNotifications() }
    } catch { showToast('通信エラー','error'); loadNotifications() }
  }

  async function markAllSelected() {
    const ids = [...selectedNotifIds]
    if (ids.length === 0) return
    setNotifs(ns => ns.filter(n => !selectedNotifIds.has(n.id)))
    setSelectedNotifIds(new Set())
    try {
      await Promise.all(ids.map(id => api.adminMarkNotificationRead(id)))
    } catch { showToast('通信エラー','error'); loadNotifications() }
  }

  // ── Settings ─────────────────────────────────────────────────────
  async function doSaveSettings() {
    setSettingsSaving(true)
    try {
      const r = await api.saveSettings(settings)
      if (r.success) showToast('設定を保存しました')
      else showToast(r.error||'保存に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setSettingsSaving(false)
  }

  function addClosedDay2(date) {
    setClosedDayAdding(true)
    api.adminSetBlockedDate(date.replace(/\//g,'-'), '')
      .then(r => {
        if (r.success) { showToast('休業日に設定しました'); loadBlocked() }
        else showToast(r.error||'設定に失敗しました','error')
      })
      .catch(() => showToast('通信エラー','error'))
      .finally(() => setClosedDayAdding(false))
  }

  // ── Computed ─────────────────────────────────────────────────────
  const adminTimeSlots = useMemo(() => {
    const all = []
    ;(settings.timeRanges || defTimeRanges).forEach(tr =>
      generateSlots(tr).forEach(s => { if (!all.includes(s)) all.push(s) })
    )
    return all.length ? all.sort() : TIME_SLOTS
  }, [settings.timeRanges])

  const seatBlockMap = useMemo(() => {
    const m = {}
    seatBlocks.forEach(sb => { m[sb.date] = sb })
    return m
  }, [seatBlocks])

  const blockedSet = useMemo(() => new Set(blocked.map(b => b.date)), [blocked])

  // dayData for calendar: keyed by 'yyyy/MM/dd'
  const resCalData = useMemo(() => {
    const m = {}
    reservations.filter(r => r.status==='確定').forEach(r => {
      if (!m[r.date]) m[r.date] = { count:0, guests:0 }
      m[r.date].count++
      m[r.date].guests += parseInt(r.guests)||0
    })
    blocked.forEach(b => {
      if (!m[b.date]) m[b.date] = { count:0, guests:0 }
      m[b.date].isBlocked = true
    })
    seatBlocks.forEach(sb => {
      if (!m[sb.date]) m[sb.date] = { count:0, guests:0 }
      m[sb.date].seatBlock = sb.blockedSeats
    })
    return m
  }, [reservations, blocked, seatBlocks])

  const blockCalData = useMemo(() => {
    const m = {}
    blocked.forEach(b => { m[b.date] = { ...(m[b.date]||{}), isBlocked:true } })
    seatBlocks.forEach(sb => { m[sb.date] = { ...(m[sb.date]||{}), seatBlock: sb.blockedSeats } })
    return m
  }, [blocked, seatBlocks])

  const dayRes = useMemo(() =>
    reservations
      .filter(r => r.date === selectedDate && r.status === '確定')
      .sort((a,b) => (formatTime(a.time) < formatTime(b.time) ? -1 : 1)),
    [reservations, selectedDate]
  )
  const dayConfirmedGuests = dayRes.filter(r=>r.status==='確定').reduce((s,r)=>s+(parseInt(r.guests)||0),0)
  const daySeatBlock       = selectedDate ? seatBlockMap[selectedDate] : null
  const dayIsBlocked       = selectedDate ? blockedSet.has(selectedDate) : false
  const dayRemaining       = Math.max(0, settings.maxSeats - (daySeatBlock?.blockedSeats||0) - dayConfirmedGuests)

  function prevMonth(y, m, setY, setM) { if (m===0) { setY(y-1); setM(11) } else setM(m-1) }
  function nextMonth(y, m, setY, setM) { if (m===11) { setY(y+1); setM(0)  } else setM(m+1) }

  // ── Main ──────────────────────────────────────────────────────
  return (
    <>
      <Head><title>管理画面 | 貝屋和光</title></Head>
      <Script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" strategy="lazyOnload" />

      {/* Login screen */}
      {!authed && (
        <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f5', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:16, padding:32, width:'100%', maxWidth:380, boxShadow:'0 2px 12px rgba(0,0,0,.1)' }}>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <h1 style={{ fontSize:18, fontWeight:'bold', color:'#06c755', marginBottom:4 }}>貝屋和光</h1>
              <p style={{ fontSize:13, color:'#888' }}>管理画面ログイン</p>
            </div>
            <div style={{ marginBottom:12 }}>
              <input type="password" value={loginPw} placeholder="パスワード"
                style={{ ...iStyle, fontSize:16 }}
                onChange={e => { setLoginPw(e.target.value); setLoginErr('') }}
                onKeyDown={e => e.key==='Enter' && doLogin()} />
            </div>
            {loginErr && (
              <div style={{ marginBottom:12, background:'#fff0f0', border:'1px solid #ffcccc', borderRadius:8, padding:'10px 14px', fontSize:13, color:'#e53935' }}>
                {loginErr}
              </div>
            )}
            <button disabled={loggingIn} onClick={doLogin}
              style={{ width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:10, fontSize:15, fontWeight:'bold', cursor:'pointer', opacity:loggingIn?0.7:1 }}>
              {loggingIn ? 'ログイン中...' : 'ログイン'}
            </button>
            <button onClick={async () => {
              const next = !showRecovery
              setShowRecovery(next)
              setRecoveryMsg({text:'',ok:true})
              setRecoveryCode('')
              if (next && !recoveryQuestion) {
                setLoadingQuestion(true)
                try {
                  const r = await api.getRecoveryQuestion()
                  setRecoveryQuestion(r.question || '合言葉の答えを入力してください')
                } catch { setRecoveryQuestion('合言葉の答えを入力してください') }
                setLoadingQuestion(false)
              }
            }} style={{ marginTop:12, background:'none', border:'none', color:'#aaa', fontSize:12, cursor:'pointer', textDecoration:'underline', width:'100%' }}>
              パスワードを忘れた方はこちら
            </button>
            {showRecovery && (
              <div style={{ marginTop:12, padding:14, background:'#f5f5f5', borderRadius:10 }}>
                <p style={{ fontSize:12, color:'#555', marginBottom:10, lineHeight:1.6 }}>
                  秘密の合言葉でパスワードを「MV」にリセットします。<br />
                  合言葉は管理画面の設定 → パスワード変更から変更できます。
                </p>
                {loadingQuestion ? (
                  <div style={{ fontSize:12, color:'#aaa', marginBottom:8 }}>読み込み中...</div>
                ) : recoveryQuestion ? (
                  <div style={{ fontSize:13, fontWeight:'bold', color:'#333', marginBottom:8, padding:'8px 12px', background:'#fff', borderRadius:8, border:'1px solid #e0e0e0' }}>
                    Q: {recoveryQuestion}
                  </div>
                ) : null}
                <input type="text" value={recoveryCode} placeholder="答えを入力"
                  style={{ ...iStyle, marginBottom:8 }}
                  onChange={e => { setRecoveryCode(e.target.value); setRecoveryMsg({text:'',ok:true}) }}
                  onKeyDown={e => e.key==='Enter' && doRecovery()} />
                {recoveryMsg.text && (
                  <div style={{ marginBottom:8, padding:'8px 12px', borderRadius:8, fontSize:12,
                    background: recoveryMsg.ok ? '#e8f5e9' : '#fff0f0',
                    color: recoveryMsg.ok ? '#2e7d32' : '#e53935' }}>
                    {recoveryMsg.text}
                  </div>
                )}
                <button disabled={recovering} onClick={doRecovery}
                  style={{ width:'100%', padding:12, background:'#555', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:'bold', cursor:'pointer', opacity:recovering?0.7:1 }}>
                  {recovering ? 'リセット中...' : 'パスワードをリセットする'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main admin (only shown when authed) */}
      {authed && <>

      {/* Header */}
      <div style={{ background:'#06c755', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'fixed', top:0, left:0, width:'100%', zIndex:10 }}>
        <h1 style={{ fontSize:16, fontWeight:'bold', color:'#fff' }}>貝屋和光 管理画面</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={doRefreshAll}
            style={{ background:'rgba(255,255,255,.2)', border:'none', color:'#fff', padding:'6px 14px', borderRadius:6, fontSize:12, cursor:'pointer' }}>
            データ更新
          </button>
          <button onClick={doLogout}
            style={{ background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.4)', color:'#fff', padding:'6px 14px', borderRadius:6, fontSize:12, cursor:'pointer' }}>
            ログアウト
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e0e0e0', display:'flex', position:'fixed', top:54, left:0, width:'100%', zIndex:9 }}>
        {[['reservations','予約一覧'], ['notifications','通知'], ['settings','設定']].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              flex:1, padding:'13px 4px', border:'none', background:'transparent',
              fontSize:13, fontWeight:'bold', cursor:'pointer',
              borderBottom: tab===id ? '3px solid #06c755' : '3px solid transparent',
              color: tab===id ? '#06c755' : '#666',
              position:'relative',
            }}>
            {label}
            {id==='notifications' && notifs.length > 0 && (
              <span style={{ position:'absolute', top:8, right:'50%', transform:'translateX(80%)',
                background:'#e53935', color:'#fff', borderRadius:10, fontSize:9, padding:'1px 5px', fontWeight:'bold', lineHeight:1.5 }}>
                {notifs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div style={{ paddingTop:100, paddingLeft:16, paddingRight:16, paddingBottom:16, maxWidth:960, margin:'0 auto' }}>

        {/* ─── TAB: 予約一覧 ──────────────────────────────────────── */}
        {tab==='reservations' && (
          <>
            {/* Today's summary */}
            {!resLoading && calYear === new Date().getFullYear() && calMonth === new Date().getMonth() && (() => {
              const now = new Date()
              const todayYMD = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`
              const todayList = reservations.filter(r => r.date === todayYMD && r.status === '確定')
              if (todayList.length === 0) return null
              const todayG = todayList.reduce((s,r) => s + (parseInt(r.guests)||0), 0)
              return (
                <div style={{ background:'#e8f5e9', border:'1px solid #c8e6c9', borderRadius:10, padding:'12px 16px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:11, color:'#555' }}>本日の確定予約</div>
                    <div style={{ fontSize:16, fontWeight:'bold', color:'#2e7d32', marginTop:2 }}>{todayList.length}組 / {todayG}名</div>
                  </div>
                  <button onClick={() => { setSelectedDate(todayYMD); setShowSeatForm(false) }} style={{ ...btnGreen, fontSize:12, padding:'7px 14px' }}>
                    詳細
                  </button>
                </div>
              )
            })()}

            {/* Calendar */}
            <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <CalNav year={calYear} month={calMonth}
                onPrev={() => prevMonth(calYear,calMonth,setCalYear,setCalMonth)}
                onNext={() => nextMonth(calYear,calMonth,setCalYear,setCalMonth)} />
              {resLoading ? (
                <div style={{ textAlign:'center', padding:20, color:'#aaa', fontSize:13 }}>読み込み中...</div>
              ) : (
                <AdminCalendar year={calYear} month={calMonth} dayData={resCalData}
                  selected={selectedDate} onSelect={d => { setSelectedDate(d); setShowSeatForm(false) }} />
              )}
              <div style={{ display:'flex', gap:12, marginTop:10, fontSize:11, color:'#888', flexWrap:'wrap' }}>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#e8f5e9', borderRadius:2, marginRight:3 }}></span>確定あり</span>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#fff3e0', borderRadius:2, marginRight:3 }}></span>停止枠あり</span>
                <span><span style={{ display:'inline-block', width:10, height:10, background:'#ffebee', borderRadius:2, marginRight:3 }}></span>休業日</span>
              </div>
              {!resLoading && reservations.length > 0 && (() => {
                const confirmed = reservations.filter(r => r.status === '確定')
                const cancelled = reservations.filter(r => r.status === 'キャンセル')
                const totalGuests = confirmed.reduce((s,r) => s + (parseInt(r.guests)||0), 0)
                return (
                  <div style={{ display:'flex', gap:8, marginTop:10, flexWrap:'wrap' }}>
                    <div style={{ background:'#e8f5e9', borderRadius:8, padding:'7px 14px', fontSize:12, display:'flex', gap:6, alignItems:'center' }}>
                      <span style={{ color:'#888' }}>今月確定</span>
                      <span style={{ fontWeight:'bold', color:'#2e7d32' }}>{confirmed.length}件 / {totalGuests}名</span>
                    </div>
                    {cancelled.length > 0 && (
                      <div style={{ background:'#ffebee', borderRadius:8, padding:'7px 14px', fontSize:12, display:'flex', gap:6, alignItems:'center' }}>
                        <span style={{ color:'#888' }}>キャンセル</span>
                        <span style={{ fontWeight:'bold', color:'#c62828' }}>{cancelled.length}件</span>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Day detail */}
            {selectedDate && (
              <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                {/* Day header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold' }}>{fmtDate(selectedDate)} の予約</h2>
                  <button onClick={() => setSelectedDate(null)}
                    style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#aaa' }}>✕</button>
                </div>

                {/* Status badges */}
                <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
                  {dayIsBlocked && (
                    <span style={{ background:'#ffebee', color:'#c62828', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      休業日
                    </span>
                  )}
                  {daySeatBlock && (
                    <span style={{ background:'#fff3e0', color:'#e65100', padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                      予約停止枠: {daySeatBlock.blockedSeats}席
                      {daySeatBlock.reason && <span style={{ fontWeight:'normal' }}>（{daySeatBlock.reason}）</span>}
                    </span>
                  )}
                  <span style={{ background: dayRemaining>0 ? '#e8f5e9' : '#ffebee',
                    color: dayRemaining>0 ? '#2e7d32' : '#c62828',
                    padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:'bold' }}>
                    残席 {dayRemaining}名
                  </span>
                </div>

                {/* Reservations for day */}
                {dayRes.length === 0 ? (
                  <div style={{ textAlign:'center', padding:'16px 0', color:'#bbb', fontSize:13 }}>予約なし</div>
                ) : (
                  <div style={{ marginBottom:12 }}>
                    {dayRes.map(r => (
                      <div key={r.id} style={{
                        padding:'12px 14px', borderRadius:8, marginBottom:8,
                        background: r.status==='確定' ? '#f8fffe' : '#fafafa',
                        border: '1px solid ' + (r.status==='確定' ? '#c8e6c9' : '#e0e0e0'),
                      }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                          <div>
                            <div style={{ fontWeight:'bold', fontSize:14 }}>
                              {formatTime(r.time)}〜{formatTime(r.endTime)}
                              <span style={{ marginLeft:10, fontSize:13, color:'#444', fontWeight:'normal' }}>{r.name} 様</span>
                              <span style={{ marginLeft:6, fontSize:13, color:'#444' }}>{r.guests}名</span>
                            </div>
                            <div style={{ fontSize:12, color:'#888', marginTop:3 }}>
                              {r.course}
                              {r.source && <span style={{ marginLeft:8, color:'#aaa' }}>{r.source}</span>}
                              {r.phone  && <span style={{ marginLeft:8 }}>{r.phone}</span>}
                            </div>
                            {r.notes && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>メモ: {r.notes}</div>}
                          </div>
                          <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center' }}>
                            <span style={{ ...statusStyle(r.status), padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:'bold' }}>
                              {r.status}
                            </span>
                            <button onClick={() => setEditRes(r)} style={btnBlue}>編集</button>
                            <button
                              disabled={cancelingResId===r.id}
                              onClick={() => deleteRes(r.id)}
                              style={{ ...btnRed, opacity: cancelingResId===r.id ? 0.6 : 1 }}>
                              {cancelingResId===r.id ? '処理中...' : '削除'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ＋新規登録 */}
                <button onClick={() => { setAddInitDate(selectedDate); setShowAddModal(true) }}
                  style={{ ...btnGreen, fontSize:13, marginBottom:10 }}>
                  ＋ 新規登録
                </button>

                {/* 受付停止席 */}
                {daySeatBlock ? (
                  <div style={{ marginTop:4, padding:14, background:'#fff8f0', border:'1px solid #ffe0b2', borderRadius:8 }}>
                    <div style={{ fontSize:12, fontWeight:'bold', color:'#e65100', marginBottom:8 }}>受付停止席</div>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <Field label="停止席数">
                        <select value={seatInput.seats}
                          onChange={e => setSeatInput(s=>({...s, seats:parseInt(e.target.value)||1}))}
                          style={{ ...sStyle, width:90 }}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}席</option>)}
                        </select>
                      </Field>
                      <Field label="理由（任意）">
                        <input type="text" value={seatInput.reason} placeholder="個室使用など"
                          onChange={e => setSeatInput(s=>({...s, reason:e.target.value}))}
                          style={{ ...iStyle, minWidth:160 }} />
                      </Field>
                      <button disabled={seatSaving} onClick={saveSeatBlockForDay}
                        style={{ ...btnGreen, alignSelf:'flex-end' }}>
                        {seatSaving?'処理中...':'更新する'}
                      </button>
                      <button disabled={seatSaving} onClick={removeSeatBlockForDay}
                        style={{ ...btnRed, alignSelf:'flex-end', padding:'9px 16px' }}>
                        {seatSaving?'処理中...':'解除する'}
                      </button>
                    </div>
                  </div>
                ) : showSeatForm ? (
                  <div style={{ marginTop:4, padding:14, background:'#fff8f0', border:'1px solid #ffe0b2', borderRadius:8 }}>
                    <div style={{ fontSize:12, fontWeight:'bold', color:'#e65100', marginBottom:8 }}>受付停止席を設定</div>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <Field label="停止席数">
                        <select value={seatInput.seats}
                          onChange={e => setSeatInput(s=>({...s, seats:parseInt(e.target.value)||1}))}
                          style={{ ...sStyle, width:90 }}>
                          {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}席</option>)}
                        </select>
                      </Field>
                      <Field label="理由（任意）">
                        <input type="text" value={seatInput.reason} placeholder="個室使用など"
                          onChange={e => setSeatInput(s=>({...s, reason:e.target.value}))}
                          style={{ ...iStyle, minWidth:160 }} />
                      </Field>
                      <button disabled={seatSaving} onClick={saveSeatBlockForDay}
                        style={{ ...btnGreen, alignSelf:'flex-end' }}>
                        {seatSaving?'処理中...':'設定する'}
                      </button>
                      <button onClick={() => setShowSeatForm(false)} style={{ ...btnGray, alignSelf:'flex-end' }}>キャンセル</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setSeatInput({ seats:4, reason:'' }); setShowSeatForm(true) }}
                    style={{ ...btnGray, fontSize:13, marginTop:4, color:'#e65100', border:'1px solid #ffe0b2' }}>
                    受付停止枠を設定
                  </button>
                )}

                {/* 休業日 */}
                {dayIsBlocked ? (
                  <div style={{ marginTop:8, padding:14, background:'#ffebee', border:'1px solid #ffcccc', borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, fontWeight:'bold', color:'#c62828' }}>休業日設定中</span>
                    <button onClick={() => removeClosedDay(selectedDate)} style={{ ...btnRed }}>解除</button>
                  </div>
                ) : (
                  <button onClick={() => addClosedDay2(selectedDate)}
                    disabled={closedDayAdding}
                    style={{ ...btnGray, fontSize:13, marginTop:8, color:'#c62828', border:'1px solid #ffcccc', opacity: closedDayAdding ? 0.6 : 1 }}>
                    {closedDayAdding ? '設定中...' : '休業日に設定'}
                  </button>
                )}
              </div>
            )}

            {!selectedDate && !resLoading && (
              <div style={{ textAlign:'center', padding:'16px 0', color:'#bbb', fontSize:13 }}>
                日付をタップすると予約一覧が表示されます
              </div>
            )}
          </>
        )}

        {/* ─── TAB: 通知一覧 ──────────────────────────────────────── */}
        {tab==='notifications' && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
              <h2 style={{ fontSize:15, fontWeight:'bold' }}>通知一覧 {notifs.length>0 && <span style={{ fontSize:13, color:'#888', fontWeight:'normal' }}>（{notifs.length}件）</span>}</h2>
              <div style={{ display:'flex', gap:8 }}>
                {selectedNotifIds.size > 0 && (
                  <button onClick={markAllSelected}
                    style={{ ...btnGreen, fontSize:13, padding:'8px 16px' }}>
                    選択済み{selectedNotifIds.size}件を確認済みに
                  </button>
                )}
                <button onClick={loadNotifications} style={btnGray}>更新</button>
              </div>
            </div>

            {notifLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : notifs.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'#bbb', fontSize:13 }}>
                未確認の通知はありません
              </div>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:12, color:'#888' }}>
                  <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}>
                    <input type="checkbox"
                      checked={notifs.length > 0 && selectedNotifIds.size === notifs.length}
                      onChange={e => setSelectedNotifIds(e.target.checked ? new Set(notifs.map(n=>n.id)) : new Set())} />
                    すべて選択
                  </label>
                </div>
                {notifs.map(n => {
                  const lbl = notifLabel(n.type)
                  const checked = selectedNotifIds.has(n.id)
                  return (
                    <div key={n.id} style={{ background: checked ? '#f0fff4' : '#fff', borderRadius:12, marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.08)', padding:'14px 16px', display:'flex', alignItems:'flex-start', gap:10, border: checked ? '1.5px solid #06c755' : '1.5px solid transparent' }}>
                      <input type="checkbox" checked={checked} style={{ marginTop:4, flexShrink:0 }}
                        onChange={e => setSelectedNotifIds(prev => { const s=new Set(prev); e.target.checked ? s.add(n.id) : s.delete(n.id); return s })} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                          <span style={{ background:lbl.bg, color:lbl.color, padding:'2px 10px', borderRadius:12, fontSize:12, fontWeight:'bold', whiteSpace:'nowrap' }}>{lbl.text}</span>
                          <span style={{ fontSize:14, fontWeight:'bold' }}>{n.name} 様</span>
                          <span style={{ fontSize:12, color:'#aaa' }}>{fmtNotifDateTime(n.datetime)}</span>
                        </div>
                        <div style={{ fontSize:13, color:'#444', marginBottom:2 }}>
                          {n.date && fmtDate(n.date)}
                          {n.time && <span style={{ marginLeft:8 }}>{formatTime(n.time)}〜{formatTime(n.endTime)}</span>}
                          {n.guests && <span style={{ marginLeft:8 }}>{n.guests}名</span>}
                          {n.phone && <span style={{ marginLeft:8, color:'#888' }}>{n.phone}</span>}
                        </div>
                        {n.type==='change' && n.oldDate && (
                          <div style={{ fontSize:12, color:'#888' }}>変更前: {fmtDate(n.oldDate)} {formatTime(n.oldTime)}〜</div>
                        )}
                        {n.notes && <div style={{ fontSize:12, color:'#888' }}>メモ: {n.notes}</div>}
                      </div>
                      <button onClick={() => markRead(n.id)}
                        style={{ ...btnGray, fontSize:12, background:'#e8f5e9', color:'#2e7d32', flexShrink:0, alignSelf:'center', padding:'8px 14px' }}>
                        確認
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}

        {/* ─── TAB: その他 ──────────────────────────────────────── */}
        {tab==='settings' && (
          <div>
            {settingsLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : (
              <>
                {/* 受付設定 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:16 }}>予約受付設定</h2>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:20, alignItems:'center' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <label style={{ fontSize:13, color:'#555', whiteSpace:'nowrap' }}>最大席数</label>
                      <select value={settings.maxSeats}
                        onChange={e => setSettings(s=>({...s, maxSeats:parseInt(e.target.value)||8}))}
                        style={{ ...sStyle, width:90 }}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}名</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 受付可能時間帯 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>受付可能時間帯</h2>
                  {defTimeRanges.map((def, i) => {
                    const tr = (settings.timeRanges||[])[i] || def
                    return (
                      <div key={def.type} style={{ display:'flex', gap:10, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
                        <span style={{ fontSize:13, fontWeight:'bold', color:'#555', width:52, flexShrink:0 }}>{def.label}</span>
                        <input type="time" value={tr.start} onChange={e=>setSettings(s=>{ const a=[...(s.timeRanges||defTimeRanges)]; a[i]={...a[i],start:e.target.value}; return {...s,timeRanges:a} })}
                          style={{ ...iStyle, width:110 }} />
                        <span style={{ fontSize:13, color:'#888' }}>〜</span>
                        <input type="time" value={tr.end} onChange={e=>setSettings(s=>{ const a=[...(s.timeRanges||defTimeRanges)]; a[i]={...a[i],end:e.target.value}; return {...s,timeRanges:a} })}
                          style={{ ...iStyle, width:110 }} />
                      </div>
                    )
                  })}
                </div>

                {/* 受付締め切りルール */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>受付締め切りルール（曜日別）</h2>
                  <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>来店日の何日前の何時まで受付するかを曜日ごとに設定します</div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ borderBottom:'2px solid #f0f0f0' }}>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal', width:60 }}>曜日</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal' }}>何日前まで</th>
                        <th style={{ textAlign:'left', padding:'6px 8px', color:'#888', fontWeight:'normal' }}>締め切り時刻</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[['0','日'],['1','月'],['2','火'],['3','水'],['4','木'],['5','金'],['6','土'],['holiday','祝']].map(([key,label]) => {
                        const rule = (settings.cutoffRules||{})[key] || { daysBefore:2, time:'22:00' }
                        return (
                          <tr key={key} style={{ borderBottom:'1px solid #f5f5f5' }}>
                            <td style={{ padding:'8px 8px', fontWeight:'bold', color: key==='0'||key==='6'||key==='holiday' ? '#e53935' : '#333' }}>{label}</td>
                            <td style={{ padding:'6px 8px' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <select value={rule.daysBefore} style={{ ...sStyle, width:65, padding:'5px 6px', fontSize:12 }}
                                  onChange={e=>setSettings(s=>({...s, cutoffRules:{...s.cutoffRules, [key]:{...rule, daysBefore:parseInt(e.target.value)||1}}}))} >
                                  {[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n}日前</option>)}
                                </select>
                              </div>
                            </td>
                            <td style={{ padding:'6px 8px' }}>
                              <input type="time" value={rule.time} style={{ ...iStyle, width:110, padding:'5px 8px', fontSize:12 }}
                                onChange={e=>setSettings(s=>({...s, cutoffRules:{...s.cutoffRules, [key]:{...rule, time:e.target.value}}}))} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* コースメニュー */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:16 }}>コースメニュー</h2>
                  {settings.courses.length === 0 ? (
                    <div style={{ textAlign:'center', padding:'16px 0', color:'#aaa', fontSize:13 }}>コースが登録されていません</div>
                  ) : (
                    settings.courses.map((c,idx) => (
                      <div key={idx} style={{ borderBottom: idx<settings.courses.length-1 ? '1px solid #f0f0f0':'none', paddingBottom:12, marginBottom:12 }}>
                        {editCourseIdx===idx ? (
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                            <Field label="コース名"><input type="text" value={editCourse.name} style={iStyle} onChange={e=>setEditCourse(c=>({...c,name:e.target.value}))} /></Field>
                            <Field label="価格（税込・円）"><input type="number" value={editCourse.price} style={iStyle} onChange={e=>setEditCourse(c=>({...c,price:parseInt(e.target.value)||0}))} /></Field>
                            <Field label="説明文" span><input type="text" value={editCourse.description} style={iStyle} onChange={e=>setEditCourse(c=>({...c,description:e.target.value}))} /></Field>
                            <Field label="所要時間（分）"><input type="number" value={editCourse.duration} style={iStyle} onChange={e=>setEditCourse(c=>({...c,duration:parseInt(e.target.value)||0}))} /></Field>
                            <Field label="食事タイプ">
                              <select value={editCourse.mealType||'dinner'} style={sStyle} onChange={e=>setEditCourse(c=>({...c,mealType:e.target.value}))}>
                                <option value="lunch">ランチ</option>
                                <option value="dinner">ディナー</option>
                                <option value="both">共通</option>
                              </select>
                            </Field>
                            <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                              <button onClick={() => { const cs=[...settings.courses]; cs[idx]={...editCourse}; setSettings(s=>({...s,courses:cs})); setEditCourseIdx(-1) }}
                                style={{ padding:'8px 18px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>保存</button>
                              <button onClick={() => setEditCourseIdx(-1)} style={btnGray}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, opacity: c.discontinued ? 0.5 : 1 }}>
                            <div>
                              <div style={{ fontSize:14, fontWeight:'bold' }}>{c.name}
                                <span style={{ marginLeft:8, fontSize:11, padding:'1px 8px', borderRadius:10, fontWeight:'normal',
                                  background: c.mealType==='lunch'?'#fff3e0':c.mealType==='both'?'#f3e5f5':'#e3f2fd',
                                  color: c.mealType==='lunch'?'#e65100':c.mealType==='both'?'#6a1b9a':'#1565c0' }}>
                                  {c.mealType==='lunch'?'ランチ':c.mealType==='both'?'共通':'ディナー'}
                                </span>
                                {c.discontinued && (
                                  <span style={{ marginLeft:6, fontSize:11, padding:'1px 8px', borderRadius:10, background:'#f5f5f5', color:'#999', fontWeight:'normal' }}>廃止中</span>
                                )}
                              </div>
                              <div style={{ fontSize:13, color:'#06c755', marginTop:2 }}>¥{Number(c.price).toLocaleString()}（税込）</div>
                              {c.description && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{c.description}</div>}
                              <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>約{c.duration}分</div>
                            </div>
                            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                              {!c.discontinued && (
                                <button onClick={() => { setEditCourse({...c}); setEditCourseIdx(idx) }} style={btnBlue}>編集</button>
                              )}
                              <button
                                onClick={() => setSettings(s=>({...s, courses:s.courses.map((x,i)=>i===idx?{...x,discontinued:!x.discontinued}:x)}))}
                                style={c.discontinued ? {...btnGreen, padding:'6px 14px', fontSize:12} : {...btnRed}}>
                                {c.discontinued ? '復活' : '廃止'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {showAddCourse ? (
                    <div style={{ marginTop:12, padding:14, background:'#f0fff4', border:'1px solid #b2ecc8', borderRadius:8 }}>
                      <h3 style={{ fontSize:13, fontWeight:'bold', marginBottom:10 }}>コースを追加</h3>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                        <Field label="コース名"><input type="text" value={newCourse.name} placeholder="例：季節の貝フルコース" style={iStyle} onChange={e=>setNewCourse(c=>({...c,name:e.target.value}))} /></Field>
                        <Field label="価格（税込・円）"><input type="number" value={newCourse.price} placeholder="11000" style={iStyle} onChange={e=>setNewCourse(c=>({...c,price:e.target.value}))} /></Field>
                        <Field label="説明文" span><input type="text" value={newCourse.description} placeholder="旬の貝と野菜をふんだんに使ったコースメニュー" style={iStyle} onChange={e=>setNewCourse(c=>({...c,description:e.target.value}))} /></Field>
                        <Field label="所要時間（分）"><input type="number" value={newCourse.duration} placeholder="150" style={iStyle} onChange={e=>setNewCourse(c=>({...c,duration:e.target.value}))} /></Field>
                        <Field label="食事タイプ">
                          <select value={newCourse.mealType||'dinner'} style={sStyle} onChange={e=>setNewCourse(c=>({...c,mealType:e.target.value}))}>
                            <option value="lunch">ランチ</option>
                            <option value="dinner">ディナー</option>
                            <option value="both">共通</option>
                          </select>
                        </Field>
                        <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                          <button onClick={() => {
                            if (!newCourse.name) return
                            setSettings(s=>({...s, courses:[...s.courses,{name:newCourse.name,price:parseInt(newCourse.price)||0,description:newCourse.description,duration:parseInt(newCourse.duration)||150,mealType:newCourse.mealType||'dinner'}]}))
                            setNewCourse({name:'',price:'',description:'',duration:150,mealType:'dinner'})
                            setShowAddCourse(false)
                          }} style={{ padding:'8px 18px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>追加する</button>
                          <button onClick={() => setShowAddCourse(false)} style={btnGray}>キャンセル</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowAddCourse(true)}
                      style={{ marginTop:12, width:'100%', padding:12, background:'#f0fff4', color:'#06c755', border:'1.5px dashed #06c755', borderRadius:8, fontSize:13, fontWeight:'bold', cursor:'pointer' }}>
                      ＋ コースを追加
                    </button>
                  )}
                </div>

                {/* 予約注意事項 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>予約確認時の注意事項・キャンセルポリシー</h2>
                  <p style={{ fontSize:12, color:'#888', marginBottom:12, lineHeight:1.6 }}>
                    予約確認画面でポップアップ表示されます。予約確認通知（LINE）にも送信されます。
                  </p>
                  <textarea
                    value={settings.bookingNotes||''}
                    onChange={e => setSettings(s=>({...s, bookingNotes:e.target.value}))}
                    placeholder={'例：\n⚠️ キャンセルポリシー\n\n当店は完全予約式です。\n\n来店2日前22:00まで：キャンセル料0%\n前日22:00まで：50%\n当日以降：100%\n\nご不明な点はお電話ください。'}
                    rows={10}
                    style={{ ...iStyle, resize:'vertical', lineHeight:1.7 }} />
                </div>

                <button disabled={settingsSaving} onClick={doSaveSettings}
                  style={{ width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:'bold', cursor:'pointer', opacity:settingsSaving?0.7:1 }}>
                  {settingsSaving?'保存中...':'設定を保存する'}
                </button>

                {/* パスワード変更 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginTop:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14 }}>管理パスワード変更</h2>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
                    <Field label="現在のパスワード">
                      <input type="password" value={pwCurrent} style={iStyle} onChange={e=>{ setPwCurrent(e.target.value); setPwMsg({text:'',ok:true}) }} />
                    </Field>
                    <Field label="新しいパスワード">
                      <input type="password" value={pwNew} placeholder="2文字以上" style={iStyle} onChange={e=>{ setPwNew(e.target.value); setPwMsg({text:'',ok:true}) }} />
                    </Field>
                  </div>
                  {pwMsg.text && (
                    <div style={{ marginBottom:10, padding:'8px 12px', borderRadius:8, fontSize:13,
                      background: pwMsg.ok ? '#e8f5e9' : '#fff0f0',
                      color: pwMsg.ok ? '#2e7d32' : '#e53935' }}>
                      {pwMsg.text}
                    </div>
                  )}
                  <button disabled={pwChanging} onClick={async () => {
                    setPwChanging(true); setPwMsg({text:'',ok:true})
                    try {
                      const r = await api.changeAdminPassword(pwCurrent, pwNew)
                      if (r.success) { setPwMsg({text:'パスワードを変更しました',ok:true}); setPwCurrent(''); setPwNew('') }
                      else setPwMsg({text:r.error||'変更に失敗しました',ok:false})
                    } catch { setPwMsg({text:'通信エラー',ok:false}) }
                    setPwChanging(false)
                  }} style={{ ...btnGreen, opacity:pwChanging?0.7:1 }}>
                    {pwChanging?'変更中...':'パスワードを変更する'}
                  </button>
                  <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid #f0f0f0' }}>
                    <div style={{ fontSize:13, fontWeight:'bold', marginBottom:10, color:'#555' }}>秘密の合言葉の変更</div>
                    <p style={{ fontSize:12, color:'#888', marginBottom:10, lineHeight:1.6 }}>
                      パスワードを忘れた際のリセットに使う「秘密の質問と答え」です。<br />
                      初期設定：質問「カイヤ貝屋の合言葉は？」 / 答え「KAIYA」
                    </p>
                    <div style={{ display:'grid', gap:10, marginBottom:10 }}>
                      <Field label="現在のパスワード（確認）">
                        <input type="password" value={rcCurrent} style={iStyle} onChange={e=>{ setRcCurrent(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                      <Field label="新しい質問文">
                        <input type="text" value={qaQuestion} placeholder="例：好きな食べ物は？" style={iStyle} onChange={e=>{ setQaQuestion(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                      <Field label="新しい答え">
                        <input type="text" value={qaAnswer} placeholder="例：貝" style={iStyle} onChange={e=>{ setQaAnswer(e.target.value); setRcMsg({text:'',ok:true}) }} />
                      </Field>
                    </div>
                    {rcMsg.text && (
                      <div style={{ marginBottom:10, padding:'8px 12px', borderRadius:8, fontSize:13,
                        background: rcMsg.ok ? '#e8f5e9' : '#fff0f0',
                        color: rcMsg.ok ? '#2e7d32' : '#e53935' }}>
                        {rcMsg.text}
                      </div>
                    )}
                    <button disabled={rcChanging} onClick={async () => {
                      setRcChanging(true); setRcMsg({text:'',ok:true})
                      try {
                        const r = await api.changeRecoveryQA(rcCurrent, qaQuestion, qaAnswer)
                        if (r.success) { setRcMsg({text:'秘密の合言葉を変更しました',ok:true}); setRcCurrent(''); setQaQuestion(''); setQaAnswer('') }
                        else setRcMsg({text:r.error||'変更に失敗しました',ok:false})
                      } catch { setRcMsg({text:'通信エラー',ok:false}) }
                      setRcChanging(false)
                    }} style={{ ...btnGray, fontSize:13 }}>
                      {rcChanging?'変更中...':'合言葉を変更する'}
                    </button>
                  </div>
                </div>

                {/* データ管理 */}
                <div style={{ background:'#fff', borderRadius:12, padding:20, marginTop:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
                  <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:6 }}>データ管理</h2>
                  <p style={{ fontSize:12, color:'#888', marginBottom:16, lineHeight:1.6 }}>
                    ダウンロードしたファイルはExcel・Numbersで開けます。データが多い場合は少し時間がかかります。
                  </p>

                  {/* 顧客データ */}
                  <div style={{ padding:16, background:'#f8fffe', border:'1px solid #c8e6c9', borderRadius:10, marginBottom:12 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
                      <div>
                        <div style={{ fontWeight:'bold', fontSize:13, marginBottom:3 }}>顧客データ</div>
                        <div style={{ fontSize:12, color:'#888' }}>氏名・電話・来店回数・LINEプロフィールなど</div>
                      </div>
                      <button disabled={custLoading} onClick={async () => {
                        setCustLoading(true)
                        try {
                          const r = await api.adminGetCustomerData()
                          const list = r.list || []
                          if (!list.length) { showToast('顧客データが0件です','error'); setCustLoading(false); return }
                          const rows = list.map(c => ({
                            '表示名（LINE）': c.displayName||'',
                            '登録名': c.name||'',
                            '電話番号': c.phone||'',
                            '来店回数': c.visitCount||0,
                            '初回来店日': c.firstVisit||'',
                            '最終来店日': c.lastVisit||'',
                            '登録日時': c.registeredAt||'',
                            'LINE UserID': c.lineUserId||'',
                            'プロフィール画像URL': c.pictureUrl||'',
                          }))
                          dlXlsx(rows, '顧客データ', 'customers.xlsx')
                          showToast('顧客データをダウンロードしました（'+list.length+'件）')
                        } catch { showToast('通信エラー','error') }
                        setCustLoading(false)
                      }} style={{ ...btnGreen, whiteSpace:'nowrap' }}>
                        {custLoading ? '取得中...' : '📥 Excelダウンロード'}
                      </button>
                    </div>
                  </div>

                  {/* 予約データ */}
                  <div style={{ padding:16, background:'#f3f8ff', border:'1px solid #bbdefb', borderRadius:10 }}>
                    <div style={{ fontWeight:'bold', fontSize:13, marginBottom:3 }}>予約データ（アーカイブ含む）</div>
                    <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>期間を選択してダウンロード（空欄=全期間）</div>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                      <input type="date" value={allResDateFrom} onChange={e=>setAllResDateFrom(e.target.value)}
                        style={{ ...iStyle, width:150, fontSize:13 }} />
                      <span style={{ fontSize:13, color:'#888' }}>〜</span>
                      <input type="date" value={allResDateTo} onChange={e=>setAllResDateTo(e.target.value)}
                        style={{ ...iStyle, width:150, fontSize:13 }} />
                    </div>
                    <button disabled={allResLoading} onClick={async () => {
                      setAllResLoading(true)
                      const filter = {}
                      if (allResDateFrom) filter.dateFrom = allResDateFrom.replace(/-/g,'/')
                      if (allResDateTo)   filter.dateTo   = allResDateTo.replace(/-/g,'/')
                      try {
                        const r = await api.adminGetAllReservations(filter)
                        const list = r.list || []
                        if (!list.length) { showToast('該当期間の予約データが0件です','error'); setAllResLoading(false); return }
                        const rows = list.map(res => ({
                          '予約日': res.date||'',
                          '時間': formatTime(res.time)||'',
                          '終了時間': formatTime(res.endTime)||'',
                          'お名前': res.name||'',
                          '電話番号': res.phone||'',
                          '人数': res.guests||'',
                          'コース': res.course||'',
                          'ステータス': res.status||'',
                          '経路': res.source||'',
                          'メモ': res.notes||'',
                          '登録日時': res.createdAt||'',
                          '予約ID': res.id||'',
                        }))
                        const label = (allResDateFrom||'') + (allResDateFrom&&allResDateTo?'〜':'') + (allResDateTo||'') || '全期間'
                        dlXlsx(rows, '予約データ', 'reservations_'+label+'.xlsx')
                        showToast('予約データをダウンロードしました（'+list.length+'件）')
                      } catch { showToast('通信エラー','error') }
                      setAllResLoading(false)
                    }} style={{ ...btnGreen, whiteSpace:'nowrap' }}>
                      {allResLoading ? '取得中...' : '📥 Excelダウンロード'}
                    </button>
                  </div>
                </div>

              </>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {editRes && (
        <EditModal res={editRes}
          onClose={() => setEditRes(null)}
          onSaved={() => { setEditRes(null); refreshRes() }}
          showToast={showToast}
          timeSlots={adminTimeSlots} />
      )}
      {showAddModal && (
        <AddModal initialDate={addInitDate}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); refreshRes() }}
          showToast={showToast}
          timeSlots={adminTimeSlots} />
      )}

      <Toast msg={toast.msg} type={toast.type} />

      </>} {/* end authed */}

      <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; background:#f5f5f5; }`}</style>
    </>
  )
}
