import { useState, useEffect } from 'react'
import Head from 'next/head'
import { api } from '../lib/api'

// 個人情報の取り扱いについての簡易な案内ページ。認証不要・公開。
// 予約フォームで氏名・電話番号・（任意で）メールアドレス・自由記述（ご利用目的・ご要望等）を収集している
// にも関わらず、その利用目的を説明するページが一切無かった（Apple CEO視点レビューでの指摘：面接予約・
// クリニック等、機微な内容を含みうる業態が増えたことで重要性が上がった）。業態を問わず正確な内容にするため、
// 実際に収集している項目・保存期間（アーカイブ運用）・利用目的だけを、店舗設定から取得した名称で案内する。
// デザインはindex.js/manual.jsと同じCSS変数・ダークモード対応の考え方に合わせる（Appleデザインチーム
// 視点レビューでの指摘：以前はこのページだけ素のインラインスタイルで浮いて見えていた）。
const SETTINGS_CACHE_KEY = 'kaiya_settings_cache_v1'

export default function Privacy() {
  const [s, setS] = useState(null)

  useEffect(() => {
    try {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && parsed.success) setS(parsed)
      }
    } catch {}
    api.getSettings().then((sr) => { if (sr && sr.success) setS(sr) }).catch(() => {})
  }, [])

  const bizName = s?.restaurantName || '当店'
  const contact = s?.contactPhone || ''
  const admin = s?.systemAdminContact || '管理者'

  return (
    <>
      <Head>
        <title>{`個人情報の取り扱いについて - ${bizName}`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <div className="wrap">
        <h1>個人情報の取り扱いについて</h1>

        <div className="card">
          <h2>収集する情報</h2>
          <p>
            ご予約の際に、お名前・お電話番号をお伺いします。メールアドレスのご登録は任意です。
            ご利用目的やご要望等（自由記述）をご記入いただく場合があります。
            LINEでご予約いただいた場合は、LINEのプロフィール情報（表示名・プロフィール画像）も予約管理に利用します。
            また、スタッフが電話予約等を代理で登録・変更した場合は、その操作の記録（お名前・日時・担当者）も残ります。
          </p>
        </div>

        <div className="card">
          <h2>利用目的</h2>
          <p>
            ご予約の受付・確認・変更・キャンセル対応、来店当日のご案内、来店後のお礼のご連絡（口コミのご依頼を含む場合があります）のためにのみ利用します。
            第三者への提供・販売は行いません。
          </p>
        </div>

        <div className="card">
          <h2>保存期間</h2>
          <p>
            ご来店日を過ぎたご予約情報は、来店回数の記録等のため別の記録（アーカイブ）に移した上で、期間を定めずに保管します。
            また、予約の登録・変更・キャンセルといった操作の記録（誰がいつ何をしたか）は、運用の適正さを確認できるようにするため、削除せず保管します。
          </p>
        </div>

        <div className="card">
          <h2>お問い合わせ</h2>
          <p>
            ご自身の情報の内容確認・訂正のご希望がある場合は、お電話にてご連絡ください{contact ? `（${contact}）` : ''}。
            来店予定のご予約（まだ日を迎えていないもの）については、ご希望に応じて削除いたします。ご来店日を過ぎたご予約の記録および操作記録（誰がいつ何をしたかの履歴）は、運用管理上の理由から削除できない場合があります。
            対応窓口：{admin}
          </p>
        </div>
      </div>

      <style jsx global>{`
        :root {
          --green: #06c755;
          --bg: #f0f0f0;
          --white: #fff;
          --text: #111;
          --sub: #666;
          --border: #e0e0e0;
        }
        :global(html), :global(body) { margin: 0; background: var(--bg); }
        .wrap {
          max-width: 640px; margin: 0 auto; padding: 24px 20px 60px;
          font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", sans-serif;
          color: var(--text);
        }
        h1 { font-size: 20px; font-weight: bold; margin: 8px 0 20px; }
        .card {
          background: var(--white); border-radius: 12px; margin-bottom: 12px;
          padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .card h2 { font-size: 15px; font-weight: bold; margin: 0 0 8px; color: var(--text); }
        .card p { font-size: 14px; line-height: 1.8; color: var(--sub); margin: 0; }
        @media (prefers-color-scheme: dark) {
          :root { --bg:#121212; --white:#1e1e1e; --text:#eee; --sub:#aaa; --border:#333; }
        }
      `}</style>
    </>
  )
}
