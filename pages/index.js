import { useState, useEffect, useCallback } from 'react'
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

function fmtDate(ymd) {
  if (!ymd) return ''
  const d = new Date(ymd.replace(/\//g, '-') + 'T00:00:00')
  const w = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}月${d.getDate()}日（${w[d.getDay()]}）`
}

function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function TimeGrid({ value, onChange }) {
  return (
    <div className="t-grid">
      {TIME_SLOTS.map((s) => (
        <button key={s} className={`t-btn${value === s ? ' sel' : ''}`} onClick={() => onChange(s)}>
          {s}
        </button>
      ))}
    </div>
  )
}

export default function Home() {
  const [screen, setScreen] = useState('loading')
  const [profile, setProfile] = useState(null)
  const [dateMin, setDateMin] = useState('')
  const [dateMax, setDateMax] = useState('')

  // New reservation form
  const [selDate, setSelDate] = useState('')
  const [selGuest, setSelGuest] = useState('')
  const [selCount, setSelCount] = useState('')
  const [selTime, setSelTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [inputErr, setInputErr] = useState('')
  const [cfErr, setCfErr] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState({ detail: '', id: '' })

  // My reservations
  const [myRes, setMyRes] = useState([])
  const [myResLoading, setMyResLoading] = useState(false)
  const [cancelId, setCancelId] = useState(null)

  // Change form
  const [changingRes, setChangingRes] = useState(null)
  const [chgDate, setChgDate] = useState('')
  const [chgTime, setChgTime] = useState('')
  const [chgErr, setChgErr] = useState('')
  const [chgcfErr, setChgcfErr] = useState('')
  const [chgSubmitting, setChgSubmitting] = useState(false)

  const isKasshiki = selGuest === 'kasshiki'
  const effectiveGuests = isKasshiki ? selCount : selGuest
  const showTimeCard = selDate && selGuest && (selGuest !== 'kasshiki' || selCount)

  const initLiff = useCallback(async () => {
    try {
      await Promise.race([
        window.liff.init({ liffId: LIFF_ID }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ])
      if (window.liff.isLoggedIn()) {
        const p = await window.liff.getProfile()
        setProfile(p)
      } else {
        window.liff.login({ redirectUri: location.href })
        return
      }
    } catch (e) {
      console.warn('LIFF:', e.message)
      setProfile({ userId: 'guest_' + Date.now(), displayName: '' })
    }
    setScreen('input')
  }, [])

  useEffect(() => {
    const now = new Date()
    const mn = new Date(now)
    mn.setDate(now.getDate() + (now.getHours() >= 22 ? 3 : 2))
    const mx = new Date(now)
    mx.setDate(now.getDate() + 90)
    setDateMin(toYMD(mn))
    setDateMax(toYMD(mx))
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [screen])

  function goConfirm() {
    if (!selDate) return setInputErr('ご来店日を選択してください')
    if (!selGuest) return setInputErr('人数を選択してください')
    if (isKasshiki && !selCount) return setInputErr('貸切の人数（6〜8名）を選択してください')
    if (!selTime) return setInputErr('来店時間を選択してください')
    if (!name.trim()) return setInputErr('お名前を入力してください')
    if (!phone.trim()) return setInputErr('電話番号を入力してください')
    setInputErr('')
    setScreen('confirm')
  }

  async function submitReservation() {
    setSubmitting(true)
    setCfErr('')
    const d = new Date(selDate + 'T00:00:00')
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    try {
      const r = await api.createReservation({
        lineUserId: profile?.userId || 'unknown',
        displayName: profile?.displayName || '',
        name: name.trim(),
        phone: phone.trim(),
        date: dateStr,
        time: selTime,
        guests: effectiveGuests,
        course: '季節の貝焼きコース',
        isKasshiki,
        notes: notes.trim(),
      })
      if (r.success) {
        setDone({
          detail: `${fmtDate(selDate)}　${selTime}〜${addMin(selTime, STAY_MIN)}\n${effectiveGuests}名様${isKasshiki ? '（貸切プラン）' : ''}\n\nLINEに確認メッセージをお送りしました。`,
          id: `予約番号：${r.reservationId}`,
        })
        setScreen('done')
      } else {
        setCfErr(r.error || '予約に失敗しました')
      }
    } catch {
      setCfErr('通信エラーが発生しました')
    }
    setSubmitting(false)
  }

  async function openMyRes() {
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
    try {
      const r = await api.cancelReservation({
        reservationId: id,
        lineUserId: profile?.userId || '',
      })
      if (r.success) {
        setMyRes((prev) => prev.map((x) => (x.id === id ? { ...x, status: 'キャンセル' } : x)))
      }
    } catch {}
    setCancelId(null)
  }

  function openChangeForm(res) {
    setChangingRes(res)
    setChgDate('')
    setChgTime('')
    setChgErr('')
    setScreen('change')
  }

  async function submitChange() {
    setChgSubmitting(true)
    setChgcfErr('')
    const d = new Date(chgDate + 'T00:00:00')
    const nd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
    try {
      const r = await api.changeReservation({
        reservationId: changingRes.id,
        lineUserId: profile?.userId || '',
        newDate: nd,
        newTime: chgTime,
      })
      if (r.success) {
        setDone({
          detail: `予約を変更しました。\n${fmtDate(chgDate)}　${chgTime}〜${addMin(chgTime, STAY_MIN)}\n\nLINEに変更確認メッセージをお送りしました。`,
          id: `予約番号：${changingRes.id}`,
        })
        setScreen('done')
      } else {
        setChgcfErr(r.error || '変更に失敗しました')
      }
    } catch {
      setChgcfErr('通信エラーが発生しました')
    }
    setChgSubmitting(false)
  }

  return (
    <>
      <Head>
        <title>貝屋和光 ご予約</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
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
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
            </div>
            <p className="ld-txt">読み込み中...</p>
          </div>
        </div>
      )}

      {/* ── INPUT FORM ── */}
      {screen === 'input' && (
        <div className="scr">
          <div className="card">
            <div className="card-lbl">🍽　コース</div>
            <div className="card-body">
              <div className="course-row">
                <div className="course-nm">季節の貝焼きコース</div>
                <div className="course-pr">
                  ¥10,000<small>（税別）</small>
                </div>
              </div>
              <div className="course-dc">
                良い食材をそのままで焼いて、あるいは蒸して。旬の貝をご堪能いただけるおまかせコースです。
              </div>
              <div>
                <span className="tag">約2時間30分</span>
                <span className="tag" style={{ marginLeft: 4 }}>
                  最大8席
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-lbl">📅　ご来店日</div>
            <div className="card-body">
              <input
                type="date"
                value={selDate}
                min={dateMin}
                max={dateMax}
                onChange={(e) => {
                  setSelDate(e.target.value)
                  setSelTime('')
                }}
              />
              <p className="hint">※ご予約は来店日の2日前22:00まで受け付けております</p>
            </div>
          </div>

          <div className="card">
            <div className="card-lbl">👥　人数</div>
            <div className="card-body">
              <div className="g-row">
                {['1', '2', '3', '4', '5'].map((n) => (
                  <button
                    key={n}
                    className={`g-btn${selGuest === n ? ' sel' : ''}`}
                    onClick={() => {
                      setSelGuest(n)
                      setSelCount('')
                      setSelTime('')
                    }}
                  >
                    {n}名
                  </button>
                ))}
              </div>
              <button
                className={`g-btn-k${isKasshiki ? ' sel' : ''}`}
                onClick={() => {
                  setSelGuest('kasshiki')
                  setSelCount('')
                  setSelTime('')
                }}
              >
                🔒 貸切プラン（6〜8名）
              </button>
              {isKasshiki && (
                <div className="k-panel">
                  <p className="k-note">
                    ご利用日に他のご予約がない場合のみ貸切でのご案内が可能です。
                    <br />
                    予約確定後にスタッフよりLINEにてご連絡いたします。
                  </p>
                  <div className="c-row">
                    {['6', '7', '8'].map((n) => (
                      <button
                        key={n}
                        className={`c-btn${selCount === n ? ' sel' : ''}`}
                        onClick={() => {
                          setSelCount(n)
                          setSelTime('')
                        }}
                      >
                        {n}名
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {showTimeCard && (
            <div className="card">
              <div className="card-lbl">⏰　来店時間</div>
              <div className="card-body">
                <TimeGrid value={selTime} onChange={setSelTime} />
                <p className="hint">受付時間 17:00〜21:00（コースは約2時間30分）</p>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-lbl">📝　ご連絡先</div>
            <div className="card-body">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="お名前（例：山田 太郎）"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="電話番号（例：090-0000-0000）"
                style={{ marginTop: 10 }}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-lbl">💬　ご要望（任意）</div>
            <div className="card-body">
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="アレルギー、お席のご希望など"
              />
            </div>
          </div>

          {inputErr && <div className="err mt12">{inputErr}</div>}
          <div className="mt16">
            <button className="btn-p" onClick={goConfirm}>
              確認画面へ　→
            </button>
          </div>
          <div className="mt8">
            <button className="myres-link" onClick={openMyRes}>
              ご予約の確認・変更はこちら
            </button>
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
                季節の貝焼きコース
                <br />
                <span style={{ fontSize: 12, fontWeight: 'normal', color: 'var(--sub)' }}>
                  ¥10,000（税別）/ お一人様　・　約2時間30分
                </span>
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">ご来店日</div>
              <div className="cf-val">{fmtDate(selDate)}</div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">時間</div>
              <div className="cf-val">
                {selTime}〜{addMin(selTime, STAY_MIN)}（目安）
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">人数</div>
              <div className="cf-val">{effectiveGuests}名様</div>
            </div>
            {isKasshiki && (
              <div className="cf-row">
                <div className="cf-lbl">プラン</div>
                <div className="cf-val acc">🔒 貸切プラン</div>
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
            {notes && (
              <div className="cf-row">
                <div className="cf-lbl">ご要望</div>
                <div className="cf-val">{notes}</div>
              </div>
            )}
          </div>
          <div className="policy">
            ⚠️ キャンセルポリシー
            <br />
            ご予約日の<strong>2日前22:00まで</strong>にご連絡ください。
          </div>
          {cfErr && <div className="err mt12">{cfErr}</div>}
          <div className="mt16">
            <button className="btn-p" disabled={submitting} onClick={submitReservation}>
              {submitting ? '送信中...' : '予約を確定する'}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('input')}>
                ← 入力画面に戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DONE ── */}
      {screen === 'done' && (
        <div className="scr">
          <div className="done-card">
            <div className="done-ck">✓</div>
            <div className="done-ttl">ご予約を承りました</div>
            <div className="done-sub" style={{ whiteSpace: 'pre-line' }}>
              {done.detail}
            </div>
            <div className="done-id">{done.id}</div>
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
                  <div className="dot" />
                  <div className="dot" />
                  <div className="dot" />
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
                  ⏰ {res.time}〜{res.endTime}　👥 {res.guests}名様
                  <br />
                  🍽 {res.course}
                  {res.notes ? (
                    <>
                      <br />
                      💬 {res.notes}
                    </>
                  ) : null}
                </div>
                {res.status === 'キャンセル' ? (
                  <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 13, fontWeight: 'bold' }}>
                    ✕ キャンセル済み
                  </div>
                ) : (
                  <>
                    <div className="res-actions">
                      <button className="btn-chg" onClick={() => openChangeForm(res)}>
                        日程・時間を変更
                      </button>
                      <button className="btn-cnl" onClick={() => setCancelId(res.id)}>
                        キャンセル
                      </button>
                    </div>
                    {cancelId === res.id && (
                      <div className="cnl-confirm">
                        <p className="cnl-msg">本当にキャンセルしますか？</p>
                        <div className="cnl-btns">
                          <button className="cnl-yes" onClick={() => execCancel(res.id)}>
                            はい
                          </button>
                          <button className="cnl-no" onClick={() => setCancelId(null)}>
                            いいえ
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
          <div className="mt8">
            <button className="btn-s" onClick={() => setScreen('input')}>
              ← 戻る
            </button>
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
                現在の予約：{fmtDate(changingRes?.date)}　{changingRes?.time}〜{changingRes?.endTime}
                <br />
                {changingRes?.guests}名様　{changingRes?.course}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-lbl">📅　新しいご来店日</div>
            <div className="card-body">
              <input
                type="date"
                value={chgDate}
                min={dateMin}
                max={dateMax}
                onChange={(e) => {
                  setChgDate(e.target.value)
                  setChgTime('')
                }}
              />
            </div>
          </div>
          {chgDate && (
            <div className="card">
              <div className="card-lbl">⏰　新しい来店時間</div>
              <div className="card-body">
                <TimeGrid value={chgTime} onChange={setChgTime} />
              </div>
            </div>
          )}
          {chgErr && <div className="err mt12">{chgErr}</div>}
          <div className="mt16">
            <button
              className="btn-p"
              onClick={() => {
                if (!chgDate) return setChgErr('新しいご来店日を選択してください')
                if (!chgTime) return setChgErr('新しい来店時間を選択してください')
                setChgErr('')
                setScreen('chgconfirm')
              }}
            >
              確認へ
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('myres')}>
                ← 戻る
              </button>
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
                {fmtDate(changingRes?.date)}　{changingRes?.time}〜{changingRes?.endTime}
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-lbl">変更後</div>
              <div className="cf-val acc">
                {fmtDate(chgDate)}　{chgTime}〜{addMin(chgTime, STAY_MIN)}
              </div>
            </div>
          </div>
          <div className="policy">
            ⚠️ 変更後の予約日が2日前22:00を過ぎている場合はキャンセル料が発生することがあります。
          </div>
          {chgcfErr && <div className="err mt12">{chgcfErr}</div>}
          <div className="mt16">
            <button className="btn-p" disabled={chgSubmitting} onClick={submitChange}>
              {chgSubmitting ? '送信中...' : '変更を確定する'}
            </button>
            <div className="mt8">
              <button className="btn-s" onClick={() => setScreen('change')}>
                ← 戻る
              </button>
            </div>
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
        body {
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          padding-bottom: 40px;
        }
        .header {
          background: var(--green);
          padding: 16px 16px 18px;
          text-align: center;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .header h1 {
          font-size: 20px;
          font-weight: bold;
          color: #fff;
          letter-spacing: 4px;
        }
        .header p {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.8);
          margin-top: 3px;
          letter-spacing: 1px;
        }
        .scr {
          padding: 14px;
          max-width: 480px;
          margin: 0 auto;
        }
        .mt8 { margin-top: 8px; }
        .mt12 { margin-top: 12px; }
        .mt16 { margin-top: 16px; }
        .card {
          background: var(--white);
          border-radius: 12px;
          margin-bottom: 12px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .card-lbl {
          font-size: 12px;
          font-weight: bold;
          color: var(--sub);
          padding: 11px 16px 9px;
          border-bottom: 1px solid var(--border);
          letter-spacing: 0.5px;
        }
        .card-body { padding: 16px; }
        .course-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }
        .course-nm { font-size: 16px; font-weight: bold; }
        .course-pr {
          font-size: 20px;
          font-weight: bold;
          color: var(--green);
          white-space: nowrap;
        }
        .course-pr small {
          font-size: 11px;
          font-weight: normal;
          color: var(--sub);
        }
        .course-dc {
          font-size: 12px;
          color: var(--sub);
          margin-top: 8px;
          line-height: 1.7;
        }
        .tag {
          display: inline-block;
          background: #f0fff4;
          color: var(--green);
          font-size: 11px;
          border-radius: 4px;
          padding: 2px 7px;
          margin-top: 8px;
        }
        input[type='date'],
        input[type='text'],
        input[type='tel'],
        textarea {
          width: 100%;
          padding: 13px 14px;
          border: 1.5px solid var(--border);
          border-radius: 8px;
          font-size: 16px;
          font-family: inherit;
          color: var(--text);
          background: #fafafa;
          -webkit-appearance: none;
          transition: border-color 0.15s;
        }
        input:focus,
        textarea:focus {
          outline: none;
          border-color: var(--green);
          background: #fff;
        }
        textarea { resize: none; }
        .g-row {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 7px;
        }
        .g-btn,
        .t-btn,
        .c-btn {
          padding: 13px 4px;
          border: 1.5px solid var(--border);
          border-radius: 8px;
          background: var(--white);
          font-size: 13px;
          font-weight: bold;
          color: var(--text);
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
        }
        .g-btn.sel,
        .t-btn.sel,
        .c-btn.sel {
          background: var(--green);
          border-color: var(--green);
          color: #fff;
        }
        .g-btn-k {
          width: 100%;
          margin-top: 8px;
          padding: 14px;
          border: 1.5px solid var(--green);
          border-radius: 8px;
          background: #f0fff4;
          font-size: 13px;
          font-weight: bold;
          color: var(--green);
          cursor: pointer;
          text-align: center;
          transition: all 0.15s;
        }
        .g-btn-k.sel {
          background: var(--green);
          color: #fff;
        }
        .k-panel {
          margin-top: 12px;
          padding: 12px 14px;
          background: #f0fff4;
          border: 1px solid #b2ecc8;
          border-radius: 8px;
        }
        .k-note {
          font-size: 12px;
          color: #2d7a4e;
          line-height: 1.7;
          margin-bottom: 10px;
        }
        .c-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 7px;
        }
        .t-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 7px;
        }
        .t-btn { padding: 14px 4px; }
        .btn-p {
          display: block;
          width: 100%;
          padding: 17px;
          background: var(--green);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: opacity 0.15s;
        }
        .btn-p:active:not(:disabled) { opacity: 0.8; }
        .btn-p:disabled { background: #ccc; cursor: not-allowed; }
        .btn-s {
          display: block;
          width: 100%;
          padding: 15px;
          background: var(--white);
          color: var(--sub);
          border: 1.5px solid var(--border);
          border-radius: 12px;
          font-size: 15px;
          cursor: pointer;
        }
        .myres-link {
          display: block;
          width: 100%;
          padding: 14px;
          background: var(--white);
          color: var(--green);
          border: 1.5px solid var(--green);
          border-radius: 12px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          text-align: center;
        }
        .err {
          background: #fff0f0;
          border: 1px solid #ffcccc;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 13px;
          color: var(--red);
        }
        .cf-row {
          display: flex;
          padding: 13px 16px;
          border-bottom: 1px solid var(--border);
          gap: 12px;
          align-items: flex-start;
        }
        .cf-row:last-child { border-bottom: none; }
        .cf-lbl {
          font-size: 12px;
          color: var(--sub);
          min-width: 64px;
          padding-top: 2px;
          white-space: nowrap;
        }
        .cf-val {
          font-size: 14px;
          font-weight: bold;
          flex: 1;
          line-height: 1.5;
        }
        .cf-val.acc { color: var(--green); }
        .policy {
          background: #fffbef;
          border: 1px solid #ffe082;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 12px;
          color: #6d5200;
          line-height: 1.7;
        }
        .done-card {
          background: var(--white);
          border-radius: 12px;
          padding: 36px 20px 32px;
          text-align: center;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .done-ck {
          width: 72px;
          height: 72px;
          background: var(--green);
          border-radius: 50%;
          margin: 0 auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
          color: #fff;
        }
        .done-ttl {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 10px;
        }
        .done-sub {
          font-size: 13px;
          color: var(--sub);
          line-height: 1.8;
        }
        .done-id {
          font-size: 11px;
          color: var(--hint);
          margin-top: 12px;
        }
        .res-card {
          background: var(--white);
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 10px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .res-date {
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        .res-detail {
          font-size: 13px;
          color: var(--sub);
          line-height: 1.7;
        }
        .res-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
        .btn-chg {
          flex: 1;
          padding: 11px;
          background: #f0fff4;
          color: var(--green);
          border: 1.5px solid var(--green);
          border-radius: 8px;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
        }
        .btn-cnl {
          flex: 1;
          padding: 11px;
          background: #fff0f0;
          color: var(--red);
          border: 1.5px solid #ffcccc;
          border-radius: 8px;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
        }
        .cnl-confirm {
          background: #fff0f0;
          border: 1px solid #ffcccc;
          border-radius: 8px;
          padding: 12px 14px;
          margin-top: 10px;
        }
        .cnl-msg {
          font-size: 13px;
          color: var(--red);
          margin-bottom: 10px;
        }
        .cnl-btns { display: flex; gap: 8px; }
        .cnl-yes {
          flex: 1;
          padding: 11px;
          background: var(--red);
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: bold;
          cursor: pointer;
        }
        .cnl-no {
          flex: 1;
          padding: 11px;
          background: var(--white);
          color: var(--sub);
          border: 1.5px solid var(--border);
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
        }
        .no-res {
          text-align: center;
          padding: 40px 20px;
          color: var(--hint);
          font-size: 14px;
        }
        .chg-current {
          background: #f8f8f8;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 13px;
          color: var(--sub);
          line-height: 1.8;
        }
        .ld-wrap {
          text-align: center;
          padding: 80px 20px;
        }
        .dots {
          display: flex;
          justify-content: center;
          gap: 8px;
        }
        .dot {
          width: 10px;
          height: 10px;
          background: var(--green);
          border-radius: 50%;
          animation: blink 1.2s infinite;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes blink {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        .ld-txt {
          margin-top: 20px;
          font-size: 14px;
          color: var(--sub);
        }
        .hint {
          font-size: 11px;
          color: var(--hint);
          margin-top: 7px;
          line-height: 1.6;
        }
      `}</style>
    </>
  )
}
