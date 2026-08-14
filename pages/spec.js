import { useState, useEffect } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'

// システム仕様書（開発権限限定）。専用パスワード（GAS側のSPEC_PASSWORDスクリプトプロパティ、
// 店舗のADMIN_PASSWORD等とは別軸）で保護する。
//
// 重要：仕様書の本文（機能一覧・セキュリティ対策・スクリプトプロパティ名等）は、このファイルには
// 一切書かない。以前はSpecContent内にJSXとして直接埋め込んでいたが、Next.jsはページのコードを
// 認証状態に関わらずクライアントJSバンドルにまるごと含めるため、パスワードを一度も入力しなくても
// ブラウザの開発者ツール（Sources/Network）からバンドルの中身を読めば全文が漏れてしまっていた
// （テスト全部隊のイーロン・ITコンサル・GAFAM視点レビューで指摘された欠陥）。
// 本文はGAS側のgetSystemSpecContent()にのみ存在し、正しいパスワードでの問い合わせが成功した
// レスポンスとしてのみブラウザに渡る。このファイルは「本文をどう組み立てて表示するか」という
// 表示ロジックだけを持つ（本文そのものは持たない）。
export default function Spec() {
  const [content, setContent] = useState(null)
  const [checking, setChecking] = useState(true)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('specContent')
      if (cached) setContent(JSON.parse(cached))
    } catch {}
    setChecking(false)
  }, [])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await api.getSystemSpec(pw)
      if (r && r.success && r.content) {
        sessionStorage.setItem('specContent', JSON.stringify(r.content))
        setContent(r.content)
      } else {
        setErr((r && r.error) || 'パスワードが正しくありません')
      }
    } catch {
      setErr('通信エラーが発生しました')
    } finally {
      setBusy(false)
    }
  }

  if (checking) return null

  if (!content) {
    return (
      <>
        <Head>
          <title>システム仕様書</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
        <div className="gate">
          <form onSubmit={submit} className="gate-card">
            <div className="gate-icon" aria-hidden="true">📐</div>
            <h1>システム仕様書</h1>
            <p>開発権限のある方のみ閲覧できます</p>
            {/* index.js/admin.jsのお名前・電話番号欄と同じく、可視ラベルを持たずplaceholderのみに
                頼っている入力欄にはaria-labelを添える（Appleデザインチーム視点レビュー・ラウンド50
                での指摘）。 */}
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
              placeholder="パスワード" aria-label="パスワード" autoFocus />
            {/* index.js/admin.jsのinputErr等と同じrole="alert"（暗黙のaria-live="assertive"）を付与
                （Appleデザインチーム視点レビュー・ラウンド50での指摘：この画面唯一のエラーなのに
                役割が無く、スクリーンリーダー利用者にはパスワード誤りが伝わらなかった）。 */}
            {err && <div className="gate-err" role="alert" aria-live="assertive">{err}</div>}
            <button type="submit" disabled={busy}>{busy ? '確認中...' : '開く'}</button>
          </form>
        </div>
        <style jsx>{`
          .gate { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #F5F7FA; padding: 20px; }
          .gate-card { background: #fff; border: 1px solid #DCE1E8; border-radius: 14px; padding: 36px 32px; width: 100%; max-width: 340px; text-align: center; box-shadow: 0 1px 3px rgba(27,36,48,0.08); }
          .gate-icon { font-size: 32px; margin-bottom: 10px; }
          .gate-card h1 { font-size: 18px; margin: 0 0 6px; color: #1B2430; }
          .gate-card p { font-size: 13px; color: #6B7688; margin: 0 0 20px; }
          .gate-card input { width: 100%; padding: 12px 14px; border: 1.5px solid #DCE1E8; border-radius: 8px; font-size: 15px; box-sizing: border-box; margin-bottom: 12px; }
          .gate-card button { width: 100%; padding: 13px; background: #2A5AA0; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: bold; cursor: pointer; }
          .gate-card button:disabled { opacity: 0.6; cursor: default; }
          .gate-err { color: #A23E3E; font-size: 12.5px; margin: -4px 0 12px; }
          @media (prefers-color-scheme: dark) {
            .gate { background: #0F141B; }
            .gate-card { background: #161C25; border-color: #29323F; }
            .gate-card h1 { color: #E7EAEE; }
          }
        `}</style>
      </>
    )
  }

  return <SpecContent content={content} onLock={() => { sessionStorage.removeItem('specContent'); setContent(null) }} />
}

// 固定のインラインstyleで表現する（styled-jsxはsource上の宣言箇所ごとにスタイルを1つ登録・
// 参照カウント方式で共有するため実際にはstyle要素が増殖するわけではないが、こちらの方が
// コンポーネントとしてシンプルで見通しが良いため採用）。ダークモードのみCSSクラス経由にする。
function Pill({ kind, children }) {
  return <span className={`pill ${kind}`}>{children}</span>
}

function statusLabel(kind) {
  return kind === 'ok' ? '実装済み' : kind === 'pending' ? '保留' : '対象外'
}

// content(サーバーから取得した本文データ)を、決まった枠に流し込むだけの表示ロジック。
// このファイル自体には本文の文言は含まれない。
function SpecContent({ content, onLock }) {
  const { overview, architecture, features, outofscope, security, qa, deploy } = content

  return (
    <>
      <Head>
        <title>汎用予約システム 仕様書</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="bar">
        <span>🔒 開発権限限定ドキュメント</span>
        <button className="lock" onClick={onLock}>ロックする</button>
      </div>
      <header className="hero">
        <div className="inner">
          <div className="eyebrow">System Specification</div>
          <h1>汎用予約システム — 仕様書</h1>
          <p>LINE予約システムの全体構成・機能・意図的に実装していない機能・運用体制をまとめたドキュメントです。営業資料や他店舗展開の検討時のベースとしても使えます。</p>
          <div className="meta">
            <span>対象：GAS 3プロジェクト ＋ Next.js（Vercel）</span>
          </div>
        </div>
      </header>

      <div className="layout">
        <nav className="side">
          <a href="#overview">概要</a>
          <a href="#architecture">全体構成</a>
          <a href="#features">機能一覧</a>
          <a href="#outofscope">対象外・保留</a>
          <a href="#security">セキュリティ</a>
          <a href="#qa">品質保証</a>
          <a href="#deploy">デプロイ・運用</a>
        </nav>

        <main>
          <section id="overview">
            <div className="eyebrow">Overview</div>
            <h2>概要</h2>
            <p className="lead">{overview.blurb}</p>
            <div className="stat-grid">
              {overview.stats.map(([n, l]) => (
                <div className="stat" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>
              ))}
            </div>
            <div className="card"><p style={{ margin: 0 }}>{overview.card}</p></div>
          </section>

          <section id="architecture">
            <div className="eyebrow">Architecture</div>
            <h2>全体構成</h2>
            <p className="lead">{architecture.blurb}</p>
            <div className="diagram card">
              <div className="d-row">
                <div className="d-box client">{architecture.diagram.client}<small>{architecture.diagram.clientSub}</small></div>
              </div>
              <div className="d-arrow">↓</div>
              <div className="d-row">
                <div className="d-box vercel"><b>{architecture.diagram.vercelTitle}</b><small>{architecture.diagram.vercelSub}</small></div>
              </div>
              <div className="d-arrow">↓ fetch</div>
              <div className="d-row three">
                {architecture.diagram.gas.map(g => (
                  <div className={`d-box gas ${g.kind}`} key={g.name}>{g.title}<br />{g.name}<br /><small>{g.desc}</small></div>
                ))}
              </div>
            </div>
            <div className="note">{architecture.note}</div>
          </section>

          <section id="features">
            <div className="eyebrow">Features</div>
            <h2>機能一覧</h2>
            <p className="lead">{features.blurb}</p>
            {features.groups.map(g => (
              <div key={g.title}>
                <h3>{g.title}</h3>
                <div className="tbl-wrap card">
                  <table>
                    <tbody>
                      {g.rows.map(([name, kind, desc]) => (
                        <tr key={name}><td>{name}</td><td><Pill kind={kind}>{statusLabel(kind)}</Pill></td><td className="desc">{desc}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          <section id="outofscope">
            <div className="eyebrow">Deliberately out of scope</div>
            <h2>対象外・保留の機能</h2>
            <p className="lead">{outofscope.blurb}</p>
            <div className="tbl-wrap card">
              <table>
                <tbody>
                  {outofscope.rows.map(([name, kind, desc]) => (
                    <tr key={name}><td>{name}</td><td><Pill kind={kind}>{statusLabel(kind)}</Pill></td><td className="desc">{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="security">
            <div className="eyebrow">Security</div>
            <h2>セキュリティ対策</h2>
            <p className="lead">{security.blurb}</p>
            <div className="grid-2">
              {security.cards.map(([title, desc]) => (
                <div className="card" key={title}>
                  <h3 style={{ marginTop: 0 }}>{title}</h3>
                  <p style={{ margin: 0 }}>{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="qa">
            <div className="eyebrow">Quality assurance</div>
            <h2>品質保証・回帰テスト</h2>
            <p className="lead">{qa.blurb}</p>
            <div className="tbl-wrap card">
              <table>
                <tbody>
                  {qa.rows.map(([name, desc]) => (
                    <tr key={name}><td><code>{name}</code></td><td className="desc">{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note">{qa.note}</div>
          </section>

          <section id="deploy">
            <div className="eyebrow">Deployment</div>
            <h2>デプロイ・運用</h2>
            <p className="lead">{deploy.blurb}</p>
            <h3>必須のスクリプトプロパティ</h3>
            <div className="tbl-wrap card">
              <table>
                <tbody>
                  {deploy.propRows.map(([prop, where, desc]) => (
                    <tr key={prop}><td><code>{prop}</code></td><td>{where}</td><td className="desc">{desc}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note">{deploy.note}</div>
          </section>
        </main>
      </div>
      <footer>汎用予約システム — システム仕様書（開発権限限定）</footer>

      <style jsx>{`
        :global(html), :global(body) { margin: 0; background: #F5F7FA; color: #1B2430; font-family: "Hiragino Sans","Yu Gothic Medium","Noto Sans JP",sans-serif; line-height: 1.85; font-size: 15px; }
        code { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans Mono",monospace; font-size: 0.92em; }
        :global(.pill) { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; white-space: nowrap; }
        :global(.pill.ok) { background: #E3F1E8; color: #2E7D4F; }
        /* 旧color:#B8791Aは背景#FBEBDに対し約3.1:1で、12px太字（WCAG 1.4.3の「大きな文字」の
           基準である14pt太字・18pt通常のいずれにも満たない）にはWCAG AAの4.5:1が必要なところ
           未達だった（Appleデザインチーム視点レビュー・ラウンド50での指摘）。同系色のまま濃くする。 */
        :global(.pill.pending) { background: #FBEBD2; color: #8F5C0F; }
        :global(.pill.off) { background: #FBE4E2; color: #A23E3E; }
        .bar { background: #1B2430; color: #F5F7FA; text-align: center; font-size: 12.5px; padding: 9px 14px; display: flex; align-items: center; justify-content: center; gap: 14px; }
        .bar .lock { background: none; border: 1px solid #47536280; color: #F5F7FA; font-size: 11px; padding: 3px 10px; border-radius: 20px; cursor: pointer; }
        .hero { padding: 46px 24px 34px; border-bottom: 1px solid #DCE1E8; background: #fff; }
        .inner { max-width: 1100px; margin: 0 auto; }
        .eyebrow { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #2A5AA0; font-weight: 700; margin-bottom: 8px; }
        h1 { font-size: clamp(24px,3.4vw,32px); margin: 0 0 8px; font-weight: 700; }
        .hero p { color: #475362; margin: 0; max-width: 640px; }
        .meta { margin-top: 14px; font-size: 12.5px; color: #6B7688; }
        .layout { max-width: 1100px; margin: 0 auto; display: flex; gap: 40px; padding: 32px 24px 90px; align-items: flex-start; }
        .side { position: sticky; top: 24px; flex: 0 0 190px; font-size: 13.5px; }
        .side a { display: block; color: #6B7688; text-decoration: none; padding: 6px 0 6px 12px; border-left: 2px solid transparent; margin-left: -1px; }
        .side a:hover { color: #2A5AA0; border-left-color: #2A5AA0; }
        main { flex: 1; min-width: 0; }
        section { margin-bottom: 48px; scroll-margin-top: 20px; }
        h2 { font-size: 21px; margin: 0 0 6px; font-weight: 700; }
        h3 { font-size: 15.5px; margin: 24px 0 10px; font-weight: 700; }
        .lead { color: #475362; margin: 0 0 18px; max-width: 680px; }
        .card { background: #fff; border: 1px solid #DCE1E8; border-radius: 12px; box-shadow: 0 1px 3px rgba(27,36,48,.08); padding: 18px 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13.8px; }
        th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #DCE1E8; vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        .tbl-wrap { overflow-x: auto; padding: 0 !important; }
        .desc { color: #475362; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .stat-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 20px; }
        .stat { background: #fff; border: 1px solid #DCE1E8; border-radius: 12px; padding: 14px 16px; }
        .stat .n { font-size: 24px; font-weight: 700; color: #2A5AA0; }
        .stat .l { font-size: 12px; color: #6B7688; margin-top: 2px; }
        .note { background: #E4ECF8; border-radius: 10px; padding: 14px 16px; font-size: 13.8px; margin-top: 14px; }
        .note b { color: #2A5AA0; }
        .diagram { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .d-row { display: flex; gap: 10px; width: 100%; justify-content: center; }
        .d-row.three { align-items: stretch; }
        .d-box { border: 1.5px solid #DCE1E8; border-radius: 10px; padding: 12px 16px; text-align: center; font-size: 13px; background: #F8FAFD; flex: 1; }
        /* 旧color:#6B7688は、この構成図の3種の背景（既定#F8FAFD／.vercelの#E4ECF8／.gas.mainの
           #E3F1E8／.gas.subの#FBEBD2）いずれに対しても3.86〜4.39:1で、11.5pxの通常文字に必要な
           WCAG AAの4.5:1に届いていなかった（他の.meta/.side a等と同じ色をここにも流用していたが、
           それらの白背景では4.59:1で足りていたため見落とされていた。Appleデザインチーム視点
           レビュー・ラウンド50での指摘）。4色すべてで4.5:1を満たす濃さに個別で上書きする。 */
        .d-box small { display: block; color: #566173; font-size: 11.5px; margin-top: 4px; font-weight: normal; }
        .d-box.client { max-width: 320px; }
        .d-box.vercel { max-width: 480px; background: #E4ECF8; border-color: #2A5AA0; }
        .d-box.gas.main { background: #E3F1E8; border-color: #2E7D4F; }
        .d-box.gas.sub { background: #FBEBD2; border-color: #B8791A; }
        .d-arrow { color: #6B7688; font-size: 13px; }
        footer { max-width: 1100px; margin: 0 auto; padding: 20px 24px 60px; color: #6B7688; font-size: 12px; border-top: 1px solid #DCE1E8; }
        @media (max-width: 860px) {
          .layout { flex-direction: column; }
          .side { position: static; flex: none; width: 100%; display: flex; flex-wrap: wrap; gap: 4px 14px; }
          .side a { padding: 4px 0; border-left: none; padding-left: 0; }
          .grid-2, .stat-grid, .d-row.three { grid-template-columns: 1fr; flex-direction: column; }
        }
        @media (max-width: 480px) {
          .d-box.client, .d-box.vercel { max-width: 100%; }
        }
        @media (prefers-color-scheme: dark) {
          :global(html), :global(body) { background: #0F141B; color: #E7EAEE; }
          :global(.pill.ok) { background: #17281D; color: #5BBE85; }
          :global(.pill.pending) { background: #2E2415; color: #E0AC52; }
          :global(.pill.off) { background: #2E1A1A; color: #E08080; }
          .bar { background: #E7EAEE; color: #0F141B; }
          .bar .lock { border-color: #0F141B80; color: #0F141B; }
          .hero { background: #161C25; border-color: #29323F; }
          .hero p { color: #B7C1CC; }
          .eyebrow { color: #6E9EDB; }
          .meta, .side a, .l, .desc, .lead, footer { color: #7C879A; }
          /* ダーク側も同じ理由（上のライトモード側コメント参照）で、.vercel/.gas.main/.gas.subの
             背景に対して3.90〜4.26:1しか出ず未達だったため、.d-box smallだけ分離して個別に
             上書きする（ラウンド50での指摘）。 */
          .d-box small { color: #8B96A8; }
          .side a:hover { color: #6E9EDB; border-left-color: #6E9EDB; }
          .card, .d-box { background: #161C25; border-color: #29323F; }
          th, td { border-color: #29323F; }
          .stat .n { color: #6E9EDB; }
          .note { background: #1E2C3D; }
          .note b { color: #6E9EDB; }
          .d-box.vercel { background: #1E2C3D; border-color: #6E9EDB; }
          .d-box.gas.main { background: #17281D; border-color: #5BBE85; }
          .d-box.gas.sub { background: #2E2415; border-color: #E0AC52; }
          footer { border-color: #29323F; }
        }
      `}</style>
    </>
  )
}
