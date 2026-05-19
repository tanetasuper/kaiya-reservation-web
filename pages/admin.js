import { useState, useEffect, useRef, useMemo } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'

const TIME_SLOTS = ['17:00','17:30','18:00','18:30','19:00','19:30','20:00','20:30','21:00']
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
function EditModal({ res, pwRef, onClose, onSaved, showToast }) {
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
      const r = await api.adminUpdateReservation(pwRef.current, { id:res.id, ...data, date: data.date.replace(/-/g,'/') })
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
            <select value={data.time} style={iStyle} onChange={set('time')}>
              {TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="人数">
            <select value={data.guests} style={iStyle} onChange={set('guests')}>
              {GUESTS.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="ステータス">
            <select value={data.status} style={iStyle} onChange={set('status')}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="経路">
            <select value={data.source} style={iStyle} onChange={set('source')}>
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
function AddModal({ initialDate, pwRef, onClose, onAdded, showToast }) {
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
      const r = await api.adminAddReservation(pwRef.current, {...data, date: data.date.replace(/-/g,'/')})
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
            <select value={data.time} style={iStyle} onChange={set('time')}>
              <option value="">-- 選択 --</option>
              {TIME_SLOTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="お名前 *">   <input type="text" value={data.name}  placeholder="山田 太郎"       style={iStyle} onChange={set('name')}  /></Field>
          <Field label="電話番号 *"> <input type="tel"  value={data.phone} placeholder="090-0000-0000"   style={iStyle} onChange={set('phone')} /></Field>
          <Field label="人数">
            <select value={data.guests} style={iStyle} onChange={set('guests')}>
              {GUESTS.map(n => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="経路">
            <select value={data.source} style={iStyle} onChange={set('source')}>
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
  const pwRef     = useRef('')
  const [authed,    setAuthed]    = useState(false)
  const [pwd,       setPwd]       = useState('')
  const [loginErr,  setLoginErr]  = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [tab,       setTab]       = useState('reservations')
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
  const [newClosedDate, setNewClosedDate] = useState('')
  const [newClosedRsn,  setNewClosedRsn]  = useState('')
  const [newSeatDate,   setNewSeatDate]   = useState('')
  const [newSeatSeats,  setNewSeatSeats]  = useState(4)
  const [newSeatRsn,    setNewSeatRsn]    = useState('')
  const [blockCalYear,  setBlockCalYear]  = useState(new Date().getFullYear())
  const [blockCalMonth, setBlockCalMonth] = useState(new Date().getMonth())

  // ── Notifications tab ────
  const [notifs,       setNotifs]       = useState([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [expandedN,    setExpandedN]    = useState(null)
  const [markingId,    setMarkingId]    = useState(null)

  // ── Settings tab ────
  const [settings,       setSettings]       = useState({ maxSeats:8, courses:[], receptionStopTime:'21:00' })
  const [settingsLoading,setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving]  = useState(false)
  const [editCourseIdx,  setEditCourseIdx]   = useState(-1)
  const [editCourse,     setEditCourse]      = useState({})
  const [showAddCourse,  setShowAddCourse]   = useState(false)
  const [newCourse,      setNewCourse]       = useState({ name:'', price:'', description:'', duration:150 })

  function showToast(msg, type='ok') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg:'', type:'ok' }), 3000)
  }

  // ── Auth ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = sessionStorage.getItem('admin_pw')
    if (saved) {
      api.adminAuth(saved).then(r => {
        if (r.ok) { pwRef.current = saved; setPwd(saved); setAuthed(true) }
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!authed) return
    loadReservations()
    loadBlocked()
    loadSeatBlocks()
    loadNotifications()
    loadSettings()
  }, [authed])

  async function doLogin() {
    const p = pwd.trim()
    if (!p) return setLoginErr('パスワードを入力してください')
    setLoggingIn(true); setLoginErr('')
    try {
      const r = await api.adminAuth(p)
      if (r.ok) { pwRef.current = p; sessionStorage.setItem('admin_pw', p); setAuthed(true) }
      else setLoginErr('パスワードが正しくありません')
    } catch { setLoginErr('通信エラーが発生しました') }
    setLoggingIn(false)
  }

  // ── Data loaders ────────────────────────────────────────────────
  async function loadReservations() {
    setResLoading(true)
    try {
      const r = await api.adminGetReservations(pwRef.current, {})
      setReservations(r.list || [])
    } catch { setReservations([]) }
    setResLoading(false)
  }

  async function loadBlocked() {
    setBlockLoading(true)
    try {
      const r = await api.adminGetBlockedDates(pwRef.current)
      setBlocked(r.list || [])
    } catch { setBlocked([]) }
    setBlockLoading(false)
  }

  async function loadSeatBlocks() {
    try {
      const r = await api.adminGetSeatBlocks(pwRef.current)
      setSeatBlocks(r.list || [])
    } catch { setSeatBlocks([]) }
  }

  async function loadNotifications() {
    setNotifLoading(true)
    try {
      const r = await api.adminGetNotifications(pwRef.current)
      setNotifs(r.list || [])
    } catch { setNotifs([]) }
    setNotifLoading(false)
  }

  async function loadSettings() {
    setSettingsLoading(true)
    try {
      const r = await api.getSettings()
      if (r.success) setSettings({ maxSeats: r.maxSeats||8, courses: r.courses||[], receptionStopTime: r.receptionStopTime||'21:00' })
    } catch {}
    setSettingsLoading(false)
  }

  // ── Reservation actions ──────────────────────────────────────────
  async function cancelRes(id) {
    setCancelingResId(id)
    try {
      const r = await api.adminUpdateReservation(pwRef.current, { id, status: 'キャンセル' })
      if (r.success) { showToast('キャンセルしました'); loadReservations() }
      else showToast(r.error||'キャンセルに失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setCancelingResId(null)
  }

  // ── Seat block for selected day ──────────────────────────────────
  async function saveSeatBlockForDay() {
    if (!selectedDate) return
    setSeatSaving(true)
    try {
      const r = await api.adminSetSeatBlock(pwRef.current, selectedDate.replace(/\//g,'-'), seatInput.seats, seatInput.reason)
      if (r.success) { showToast('予約停止枠を設定しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setSeatSaving(false)
  }

  async function removeSeatBlockForDay() {
    if (!selectedDate) return
    setSeatSaving(true)
    try {
      const r = await api.adminRemoveSeatBlock(pwRef.current, selectedDate.replace(/\//g,'-'))
      if (r.success) { showToast('予約停止枠を解除しました'); setShowSeatForm(false); loadSeatBlocks() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
    setSeatSaving(false)
  }

  // ── Block tab actions ────────────────────────────────────────────
  async function addClosedDay() {
    if (!newClosedDate) return showToast('日付を選択してください','error')
    try {
      const r = await api.adminSetBlockedDate(pwRef.current, newClosedDate, newClosedRsn)
      if (r.success) { showToast('休業日を設定しました'); setNewClosedDate(''); setNewClosedRsn(''); loadBlocked() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラー','error') }
  }

  async function removeClosedDay(date) {
    try {
      const r = await api.adminRemoveBlockedDate(pwRef.current, date)
      if (r.success) { showToast('削除しました'); loadBlocked() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
  }

  async function addSeatBlock() {
    if (!newSeatDate)          return showToast('日付を選択してください','error')
    if (newSeatSeats < 1)      return showToast('1以上の席数を入力してください','error')
    try {
      const r = await api.adminSetSeatBlock(pwRef.current, newSeatDate, newSeatSeats, newSeatRsn)
      if (r.success) { showToast('予約停止枠を設定しました'); setNewSeatDate(''); setNewSeatSeats(4); setNewSeatRsn(''); loadSeatBlocks() }
      else showToast(r.error||'設定に失敗しました','error')
    } catch { showToast('通信エラー','error') }
  }

  async function removeSeatBlock(date) {
    try {
      const r = await api.adminRemoveSeatBlock(pwRef.current, date)
      if (r.success) { showToast('削除しました'); loadSeatBlocks() }
      else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
  }

  // ── Notification actions ─────────────────────────────────────────
  async function markRead(id) {
    setMarkingId(id)
    try {
      const r = await api.adminMarkNotificationRead(pwRef.current, id)
      if (r.success) {
        setNotifs(ns => ns.filter(n => n.id !== id))
        if (expandedN === id) setExpandedN(null)
        showToast('確認済みにしました')
      } else showToast(r.error||'エラー','error')
    } catch { showToast('通信エラー','error') }
    setMarkingId(null)
  }

  // ── Settings ─────────────────────────────────────────────────────
  async function doSaveSettings() {
    setSettingsSaving(true)
    try {
      const r = await api.saveSettings(pwRef.current, settings)
      if (r.success) showToast('設定を保存しました')
      else showToast(r.error||'保存に失敗しました','error')
    } catch { showToast('通信エラー','error') }
    setSettingsSaving(false)
  }

  function addClosedDay2(date) {
    api.adminSetBlockedDate(pwRef.current, date.replace(/\//g,'-'), '')
      .then(r => {
        if (r.success) { showToast('休業日に設定しました'); loadBlocked() }
        else showToast(r.error||'設定に失敗しました','error')
      })
      .catch(() => showToast('通信エラー','error'))
  }

  // ── Computed ─────────────────────────────────────────────────────
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
      .filter(r => r.date === selectedDate)
      .sort((a,b) => (formatTime(a.time) < formatTime(b.time) ? -1 : 1)),
    [reservations, selectedDate]
  )
  const dayConfirmedGuests = dayRes.filter(r=>r.status==='確定').reduce((s,r)=>s+(parseInt(r.guests)||0),0)
  const daySeatBlock       = selectedDate ? seatBlockMap[selectedDate] : null
  const dayIsBlocked       = selectedDate ? blockedSet.has(selectedDate) : false
  const dayRemaining       = Math.max(0, settings.maxSeats - (daySeatBlock?.blockedSeats||0) - dayConfirmedGuests)

  function prevMonth(y, m, setY, setM) { if (m===0) { setY(y-1); setM(11) } else setM(m-1) }
  function nextMonth(y, m, setY, setM) { if (m===11) { setY(y+1); setM(0)  } else setM(m+1) }

  // ── Login ──────────────────────────────────────────────────────
  if (!authed) return (
    <>
      <Head><title>ログイン | 貝屋和光 管理画面</title></Head>
      <div style={{ minHeight:'100vh', background:'#f0f0f0', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
        <div style={{ background:'#fff', borderRadius:16, padding:'40px 32px', width:'100%', maxWidth:360, boxShadow:'0 4px 20px rgba(0,0,0,.1)' }}>
          <h1 style={{ textAlign:'center', fontSize:18, fontWeight:'bold', marginBottom:6 }}>貝屋和光 管理画面</h1>
          <p style={{ textAlign:'center', fontSize:12, color:'#888', marginBottom:28 }}>管理者パスワードを入力してください</p>
          <input type="password" value={pwd}
            onChange={e => setPwd(e.target.value)}
            onKeyDown={e => e.key==='Enter' && doLogin()}
            placeholder="パスワード"
            style={{ ...iStyle, fontSize:16, padding:'13px 14px', marginBottom:12 }} />
          {loginErr && <p style={{ color:'#e53935', fontSize:13, marginBottom:10 }}>{loginErr}</p>}
          <button disabled={loggingIn} onClick={doLogin}
            style={{ width:'100%', padding:16, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:16, fontWeight:'bold', cursor:'pointer' }}>
            {loggingIn?'認証中...':'ログイン'}
          </button>
        </div>
      </div>
      <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; }`}</style>
    </>
  )

  // ── Main ──────────────────────────────────────────────────────
  return (
    <>
      <Head><title>管理画面 | 貝屋和光</title></Head>

      {/* Header */}
      <div style={{ background:'#06c755', padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', position:'sticky', top:0, zIndex:10 }}>
        <h1 style={{ fontSize:16, fontWeight:'bold', color:'#fff' }}>貝屋和光 管理画面</h1>
        <button
          onClick={() => { sessionStorage.removeItem('admin_pw'); setAuthed(false); setPwd(''); pwRef.current='' }}
          style={{ background:'rgba(255,255,255,.2)', border:'none', color:'#fff', padding:'6px 14px', borderRadius:6, fontSize:12, cursor:'pointer' }}>
          ログアウト
        </button>
      </div>

      {/* Tabs */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e0e0e0', display:'flex', position:'sticky', top:48, zIndex:9 }}>
        {[['reservations','予約一覧'], ['block','ブロック'], ['notifications','通知'], ['settings','その他']].map(([id,label]) => (
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

      <div style={{ padding:16, maxWidth:960, margin:'0 auto' }}>

        {/* ─── TAB: 予約一覧 ──────────────────────────────────────── */}
        {tab==='reservations' && (
          <>
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
                              onClick={() => cancelRes(r.id)}
                              style={{ ...btnRed, opacity: cancelingResId===r.id ? 0.6 : 1 }}>
                              {cancelingResId===r.id ? '処理中...' : 'キャンセル'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  <button onClick={() => { setAddInitDate(selectedDate); setShowAddModal(true) }}
                    style={{ ...btnGreen, fontSize:13 }}>
                    ＋ 新規登録
                  </button>
                  <button onClick={() => {
                    setSeatInput({ seats: daySeatBlock?.blockedSeats||4, reason: daySeatBlock?.reason||'' })
                    setShowSeatForm(f => !f)
                  }}
                    style={{ ...btnGray, background: showSeatForm?'#e0e0e0':'#f0f0f0' }}>
                    予約ブロック
                  </button>
                  {dayIsBlocked ? (
                    <button onClick={() => removeClosedDay(selectedDate)}
                      style={{ ...btnRed }}>
                      休業日を解除
                    </button>
                  ) : (
                    <button onClick={() => addClosedDay2(selectedDate)}
                      style={{ ...btnGray, color:'#c62828', border:'1px solid #ffcccc' }}>
                      休業日に設定
                    </button>
                  )}
                </div>

                {/* Seat block inline form */}
                {showSeatForm && (
                  <div style={{ marginTop:12, padding:14, background:'#fff8f0', border:'1px solid #ffe0b2', borderRadius:8 }}>
                    <div style={{ fontSize:13, fontWeight:'bold', marginBottom:10, color:'#e65100' }}>予約停止枠の設定</div>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <Field label="停止席数">
                        <input type="number" min={1} max={8} value={seatInput.seats}
                          onChange={e => setSeatInput(s=>({...s, seats:parseInt(e.target.value)||1}))}
                          style={{ ...iStyle, width:80 }} />
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
                      {daySeatBlock && (
                        <button disabled={seatSaving} onClick={removeSeatBlockForDay}
                          style={{ ...btnRed, alignSelf:'flex-end', padding:'9px 16px' }}>
                          解除する
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!selectedDate && !resLoading && (
              <div style={{ textAlign:'center', padding:'24px 0', color:'#bbb', fontSize:13 }}>
                日付をタップすると予約一覧が表示されます
              </div>
            )}
          </>
        )}

        {/* ─── TAB: ブロック ──────────────────────────────────────── */}
        {tab==='block' && (
          <>
            {/* Calendar */}
            <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <CalNav year={blockCalYear} month={blockCalMonth}
                onPrev={() => prevMonth(blockCalYear,blockCalMonth,setBlockCalYear,setBlockCalMonth)}
                onNext={() => nextMonth(blockCalYear,blockCalMonth,setBlockCalYear,setBlockCalMonth)} />
              <AdminCalendar year={blockCalYear} month={blockCalMonth} dayData={blockCalData}
                selected={null} onSelect={ymd => {
                  setNewSeatDate(ymd.replace(/\//g,'-'))
                  setNewClosedDate(ymd.replace(/\//g,'-'))
                }} />
              <p style={{ fontSize:11, color:'#aaa', marginTop:8, textAlign:'center' }}>
                日付をタップすると下の入力欄にセットされます
              </p>
            </div>

            {/* 予約停止枠 section */}
            <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14, color:'#e65100' }}>予約停止枠</h2>
              <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>特定の日の受付席数を制限します（部分的な予約停止）</div>

              {/* Add seat block */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', marginBottom:14, padding:12, background:'#fff8f0', borderRadius:8, border:'1px solid #ffe0b2' }}>
                <Field label="日付 *">
                  <input type="date" value={newSeatDate} onChange={e=>setNewSeatDate(e.target.value)}
                    style={{ ...iStyle, width:'auto' }} />
                </Field>
                <Field label="停止席数 *">
                  <input type="number" min={1} max={8} value={newSeatSeats}
                    onChange={e=>setNewSeatSeats(parseInt(e.target.value)||1)}
                    style={{ ...iStyle, width:80 }} />
                </Field>
                <Field label="理由（任意）">
                  <input type="text" value={newSeatRsn} placeholder="個室使用・VIPなど"
                    onChange={e=>setNewSeatRsn(e.target.value)}
                    style={{ ...iStyle, minWidth:160 }} />
                </Field>
                <button onClick={addSeatBlock}
                  style={{ ...btnGreen, alignSelf:'flex-end' }}>追加</button>
              </div>

              {/* List */}
              {seatBlocks.length === 0 ? (
                <div style={{ textAlign:'center', padding:'14px 0', color:'#bbb', fontSize:13 }}>予約停止枠の設定はありません</div>
              ) : (
                seatBlocks.map((sb,i) => (
                  <div key={sb.date} style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'12px 14px',
                    borderBottom: i<seatBlocks.length-1 ? '1px solid #f0f0f0' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:'bold' }}>
                        {fmtDate(sb.date)}
                        <span style={{ marginLeft:10, color:'#e65100' }}>{sb.blockedSeats}席停止</span>
                      </div>
                      {sb.reason && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{sb.reason}</div>}
                    </div>
                    <button onClick={() => removeSeatBlock(sb.date)} style={btnRed}>削除</button>
                  </div>
                ))
              )}
            </div>

            {/* 休業日 section */}
            <div style={{ background:'#fff', borderRadius:12, padding:16, marginBottom:12, boxShadow:'0 1px 3px rgba(0,0,0,.08)' }}>
              <h2 style={{ fontSize:15, fontWeight:'bold', marginBottom:14, color:'#c62828' }}>休業日</h2>
              <div style={{ fontSize:12, color:'#888', marginBottom:12 }}>この日は全ての予約受付を停止します</div>

              {/* Add */}
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', marginBottom:14, padding:12, background:'#fff8f8', borderRadius:8, border:'1px solid #ffcccc' }}>
                <Field label="日付 *">
                  <input type="date" value={newClosedDate} onChange={e=>setNewClosedDate(e.target.value)}
                    style={{ ...iStyle, width:'auto' }} />
                </Field>
                <Field label="理由（任意）">
                  <input type="text" value={newClosedRsn} placeholder="定休日・貸切など"
                    onChange={e=>setNewClosedRsn(e.target.value)}
                    style={{ ...iStyle, minWidth:180 }} />
                </Field>
                <button onClick={addClosedDay}
                  style={{ ...btnGreen, background:'#e53935', alignSelf:'flex-end' }}>追加</button>
              </div>

              {blockLoading ? (
                <div style={{ textAlign:'center', padding:'14px 0', color:'#aaa', fontSize:13 }}>読み込み中...</div>
              ) : blocked.length === 0 ? (
                <div style={{ textAlign:'center', padding:'14px 0', color:'#bbb', fontSize:13 }}>休業日の設定はありません</div>
              ) : (
                blocked.map((b,i) => (
                  <div key={b.date} style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'12px 14px',
                    borderBottom: i<blocked.length-1 ? '1px solid #f0f0f0' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:'bold' }}>{fmtDate(b.date)}</div>
                      {b.reason && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{b.reason}</div>}
                    </div>
                    <button onClick={() => removeClosedDay(b.date)} style={btnRed}>削除</button>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ─── TAB: 通知一覧 ──────────────────────────────────────── */}
        {tab==='notifications' && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <h2 style={{ fontSize:15, fontWeight:'bold' }}>通知一覧 {notifs.length>0 && <span style={{ fontSize:13, color:'#888', fontWeight:'normal' }}>（{notifs.length}件）</span>}</h2>
              <button onClick={loadNotifications} style={btnGray}>更新</button>
            </div>

            {notifLoading ? (
              <div style={{ textAlign:'center', padding:40, color:'#aaa' }}>読み込み中...</div>
            ) : notifs.length === 0 ? (
              <div style={{ textAlign:'center', padding:40, color:'#bbb', fontSize:13 }}>
                未確認の通知はありません
              </div>
            ) : (
              notifs.map(n => {
                const lbl = notifLabel(n.type)
                const expanded = expandedN === n.id
                return (
                  <div key={n.id} style={{ background:'#fff', borderRadius:12, marginBottom:8, boxShadow:'0 1px 3px rgba(0,0,0,.08)', overflow:'hidden' }}>
                    <div style={{ padding:'14px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                            <span style={{ background:lbl.bg, color:lbl.color, padding:'2px 10px', borderRadius:12, fontSize:12, fontWeight:'bold', whiteSpace:'nowrap' }}>
                              {lbl.text}
                            </span>
                            <span style={{ fontSize:12, color:'#aaa' }}>{n.datetime}</span>
                          </div>
                          <div style={{ fontSize:14, fontWeight:'bold' }}>
                            {n.name} 様
                            {n.date && <span style={{ marginLeft:8, fontSize:13, fontWeight:'normal', color:'#444' }}>{fmtDate(n.date)}</span>}
                            {n.time && <span style={{ marginLeft:6, fontSize:13, color:'#444' }}>{formatTime(n.time)}〜</span>}
                            {n.guests && <span style={{ marginLeft:6, fontSize:13, color:'#444' }}>{n.guests}名</span>}
                          </div>
                          {n.type==='change' && n.oldDate && (
                            <div style={{ fontSize:12, color:'#888', marginTop:4 }}>
                              変更前: {fmtDate(n.oldDate)} {formatTime(n.oldTime)}〜
                            </div>
                          )}
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center' }}>
                          <button
                            onClick={() => setExpandedN(expanded ? null : n.id)}
                            style={{ ...btnBlue, fontSize:11, padding:'4px 10px' }}>
                            {expanded ? '閉じる▲' : '詳細▼'}
                          </button>
                          <button
                            disabled={markingId===n.id}
                            onClick={() => markRead(n.id)}
                            style={{ ...btnGray, fontSize:12, background:'#e8f5e9', color:'#2e7d32' }}>
                            {markingId===n.id ? '処理中...' : '確認済'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ padding:'0 16px 14px', background:'#fafafa', borderTop:'1px solid #f0f0f0' }}>
                        <table style={{ fontSize:12, color:'#555', borderCollapse:'collapse', marginTop:10 }}>
                          <tbody>
                            {[
                              ['名前', n.name],
                              ['来店日', fmtDate(n.date)],
                              ['時間', n.time ? formatTime(n.time)+'〜'+formatTime(n.endTime) : '-'],
                              ['人数', n.guests ? n.guests+'名' : '-'],
                              ['電話', n.phone || '-'],
                              n.type==='change' && ['変更前来店日', fmtDate(n.oldDate)],
                              n.type==='change' && ['変更前時間', n.oldTime ? formatTime(n.oldTime)+'〜' : '-'],
                              ['メモ', n.notes || '-'],
                            ].filter(Boolean).map(([k,v]) => (
                              <tr key={k}>
                                <td style={{ paddingRight:16, paddingBottom:4, color:'#aaa', whiteSpace:'nowrap' }}>{k}</td>
                                <td style={{ paddingBottom:4 }}>{v}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })
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
                      <input type="number" min={1} max={20} value={settings.maxSeats}
                        onChange={e => setSettings(s=>({...s, maxSeats:parseInt(e.target.value)||8}))}
                        style={{ ...iStyle, width:80 }} />
                      <span style={{ fontSize:12, color:'#aaa' }}>名</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <label style={{ fontSize:13, color:'#555', whiteSpace:'nowrap' }}>受付停止時間</label>
                      <input type="time" value={settings.receptionStopTime}
                        onChange={e => setSettings(s=>({...s, receptionStopTime:e.target.value}))}
                        style={{ ...iStyle, width:120 }} />
                      <span style={{ fontSize:12, color:'#aaa' }}>以降は新規受付停止</span>
                    </div>
                  </div>
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
                            <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                              <button onClick={() => { const cs=[...settings.courses]; cs[idx]={...editCourse}; setSettings(s=>({...s,courses:cs})); setEditCourseIdx(-1) }}
                                style={{ padding:'8px 18px', background:'#06c755', color:'#fff', border:'none', borderRadius:8, fontSize:13, cursor:'pointer' }}>保存</button>
                              <button onClick={() => setEditCourseIdx(-1)} style={btnGray}>キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                            <div>
                              <div style={{ fontSize:14, fontWeight:'bold' }}>{c.name}</div>
                              <div style={{ fontSize:13, color:'#06c755', marginTop:2 }}>¥{Number(c.price).toLocaleString()}（税込）</div>
                              {c.description && <div style={{ fontSize:12, color:'#888', marginTop:2 }}>{c.description}</div>}
                              <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>約{c.duration}分</div>
                            </div>
                            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                              <button onClick={() => { setEditCourse({...c}); setEditCourseIdx(idx) }} style={btnBlue}>編集</button>
                              <button onClick={() => setSettings(s=>({...s,courses:s.courses.filter((_,i)=>i!==idx)}))} style={btnRed}>削除</button>
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
                        <div style={{ gridColumn:'1/-1', display:'flex', gap:8, marginTop:4 }}>
                          <button onClick={() => {
                            if (!newCourse.name) return
                            setSettings(s=>({...s, courses:[...s.courses,{name:newCourse.name,price:parseInt(newCourse.price)||0,description:newCourse.description,duration:parseInt(newCourse.duration)||150}]}))
                            setNewCourse({name:'',price:'',description:'',duration:150})
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

                <button disabled={settingsSaving} onClick={doSaveSettings}
                  style={{ width:'100%', padding:15, background:'#06c755', color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:'bold', cursor:'pointer', opacity:settingsSaving?0.7:1 }}>
                  {settingsSaving?'保存中...':'設定を保存する'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {editRes && (
        <EditModal res={editRes} pwRef={pwRef}
          onClose={() => setEditRes(null)}
          onSaved={() => { setEditRes(null); loadReservations() }}
          showToast={showToast} />
      )}
      {showAddModal && (
        <AddModal initialDate={addInitDate} pwRef={pwRef}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); loadReservations() }}
          showToast={showToast} />
      )}

      <Toast msg={toast.msg} type={toast.type} />
      <style jsx global>{`* { box-sizing:border-box; margin:0; padding:0; } body { font-family:-apple-system,'Hiragino Sans',sans-serif; background:#f5f5f5; }`}</style>
    </>
  )
}
