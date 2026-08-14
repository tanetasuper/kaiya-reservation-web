// 多言語対応（i18n）。
// 方式：日本語の原文をキーにして英語訳を引く辞書方式（t('日本語の文言') → 言語がenならEN_DICTの訳、無ければ原文のまま）。
// これにより既存のJSXを大きく書き換えずに翻訳を差し込める。訳が用意されていない文言はそのまま日本語で表示される
// （壊れるのではなく「まだ訳していない」という状態になるだけ、というフォールバック設計）。
//
// 対応範囲：予約の基本フロー（日付・時間・人数・連絡先・確認・完了・マイ予約・変更）の文言を優先的に英訳している。
// 貸切・大人数相談・キャンセル待ち・期限後依頼などの一部の文言、および店側が入力するコース名・Q1/Q2の選択肢・
// 店舗からのお知らせ文（bookingNotes）等の「コンテンツ」は今回は翻訳対象外（店舗ごとに異なる自由入力のため、
// 多言語で入力する仕組み自体が別途必要になる。現状は店が入力した言語のまま表示される）。

export const LANGUAGES = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
]

export function makeT(lang) {
  const dict = lang === 'en' ? EN_DICT : null
  return function t(ja) {
    if (!dict) return ja
    return dict[ja] !== undefined ? dict[ja] : ja
  }
}

const EN_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// 英語表記で月・日をそのまま返す（"8/6"のような数字だけの表記はM/D・D/Mのどちらか読者次第で
// 誤読される——アメリカ式読者はM/D、それ以外はD/Mで読み、日付が数週間ズレて伝わることがある。
// index.js内の他の英語日付表記は全てfmtDateLangの月名スペルアウト表記なので、それに合わせて
// 揺れを無くす（Google CEO視点レビューでの指摘）。
export function fmtMonthDayEn(month1to12, day) {
  return `${EN_MONTHS[month1to12 - 1]} ${day}`
}

// yyyy/MM/dd or yyyy-MM-dd → 言語に応じた日付表記
export function fmtDateLang(ymd, lang) {
  if (!ymd) return ''
  const parts = String(ymd).replace(/\//g, '-').split('-')
  if (parts.length !== 3) return String(ymd)
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
  if (lang === 'en') {
    const w = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    return `${fmtMonthDayEn(d.getMonth() + 1, d.getDate())} (${w[d.getDay()]})`
  }
  const w = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}月${d.getDate()}日（${w[d.getDay()]}）`
}

const EN_DICT = {
  // ヘッダー・共通
  '読み込み中...': 'Loading...',
  '通信状況により、時間がかかる場合があります。しばらくお待ちください。': 'This may take a moment depending on your connection. Please wait.',
  '確認中...': 'Checking...',
  '空き状況を確認中...': 'Checking availability...',
  '空き状況を確認中です。少し待ってからもう一度お試しください': 'Still checking availability. Please wait a moment and try again.',
  'カレンダー取得中...': 'Loading calendar...',
  '満席': 'Full',
  '条件あり': 'Conditions apply',
  '担当者を確認中...': 'Checking availability...',
  '🔖 ご指名（任意）': '🔖  Requested staff (optional)',
  '指名なし': 'No preference',
  '上記の同意チェックが必要です': 'Please check the box above to continue',
  'ご入力いただいた情報の取り扱い（': 'I agree to how my information will be handled (',
  '）に同意します': ')',
  'こちら': 'here',
  '⚠️ ご予約にあたっての注意事項': '⚠️ Booking Terms & Notes',
  '確認しました　→': 'I understand　→',

  // LINEログイン選択（PC・LINE外ブラウザ）
  'ご予約方法をお選びください': 'Please choose how you would like to book',
  'LINEでログインして予約する': 'Log in with LINE',
  'LINEを使わずに予約する': 'Book without LINE',
  'LINEアカウントをお持ちの方向けです。LINEのサイトに移動します': "For customers with a LINE account. You'll be taken to LINE's site",
  'LINEアカウントが無い方・お持ちでない方はこちら。お名前と電話番号でご予約いただけます': "For customers without a LINE account. You can book with just your name and phone number",

  // 広告枠
  '広告': 'Ad',

  // ゲストモードの案内
  'LINEなしでご予約いただけます。ご予約の確認・変更・キャンセルは「マイ予約」から電話番号で検索できます': 'You can book without LINE. To check, change, or cancel your booking, use "My Bookings" and search by phone number',
  '（メールアドレスをご登録いただくと確認メールもお送りします）': ' (register an email address to also receive a confirmation email)',
  '。お困りの際はお電話（': '. If you need help, please call us at ',
  '）にもご連絡いただけます。': '.',

  // 下書き復元の案内（sessionStorageからの入力内容復元、ラウンド46）
  '前回入力いただいた内容を復元しました。内容をご確認のうえ、続きをご入力ください': 'We restored what you entered last time. Please review it before continuing',

  // 日付・時間・人数・コース選択カード
  '🍽　': '',
  '📅　ご来店日': '📅  Date',
  '⏰　来店時間': '⏰  Time',
  '👥　人数': '👥  Party size',
  '📝　ご連絡先': '📝  Contact Info',
  'お名前（例：山田 太郎）': 'Name (e.g. John Smith)',
  '電話番号（例：090-0000-0000）': 'Phone number',
  'メールアドレス（確認メールをお送りします）': 'Email (we will send a confirmation)',
  'メールアドレス（任意）': 'Email (optional)',
  'LINEでのご案内が届かないため、確認・変更・キャンセルのためにメールアドレスをご登録ください。': 'Since you cannot receive LINE messages, please provide an email address so we can confirm, change, or cancel your booking.',

  // ボタン・アクション
  '確認画面へ　→': 'Review Booking →',
  'ご予約の確認・変更はこちら': 'Check / Change My Booking',
  '別の予約をする': 'Make Another Booking',
  '＋ ご利用目的・ご要望等を追加する（任意）': '+ Add purpose of visit, requests, etc. (optional)',
  '＋ ご指名・ご利用目的・ご要望等を追加する（任意）': '+ Add requested staff, purpose of visit, requests, etc. (optional)',
  '確認する': 'Search',
  '確認中...→btn': 'Searching...',

  // エラーメッセージ
  'ご来店日を選択してください': 'Please select a date',
  '来店時間を選択してください': 'Please select a time',
  '人数を選択してください': 'Please select a party size',
  'お名前を入力してください': 'Please enter your name',
  '電話番号を入力してください': 'Please enter your phone number',
  'メールアドレスを入力してください': 'Please enter your email address',
  '電話番号の形式が正しくありません': 'Please enter a valid phone number',
  'メールアドレスの形式が正しくありません': 'Please enter a valid email address',
  '通信がタイムアウトしました': 'The connection timed out',
  '通信エラーが発生しました。もう一度お試しください。': 'A connection error occurred. Please try again.',
  '予約の読み込みに失敗しました。もう一度お試しください。': 'Failed to load your bookings. Please try again.',
  'お名前と電話番号を入力してください': 'Please enter your name and phone number',
  'キャンセル待ちの登録に失敗しました': 'Failed to join the waitlist',
  'キャンセルに失敗しました。お手数ですがお電話にてご連絡ください。': "Failed to cancel. We're sorry for the inconvenience — please call us.",
  '送信に失敗しました': 'Failed to send',
  '通信エラーが発生しました。お電話にてご連絡ください': 'A connection error occurred. Please call us.',
  '再試行': 'Retry',
  '予約に失敗しました': 'Failed to complete your booking',
  'プラン': 'Plan',
  '💬 貸切要相談': '💬 Private hire (consultation)',
  '🔒 貸切プラン': '🔒 Private-hire plan',
  '通信エラーが発生しました。もう一度お試しいただき、失敗する場合はお電話にてご連絡ください。': 'A connection error occurred. Please try again, and call us if it keeps failing.',
  '残席の確認に失敗しました。電波の良い場所でもう一度お試しください。': 'Failed to check availability. Please try again with a better connection.',
  '担当者の確認に失敗しました。電波の良い場所でもう一度お試しください。': 'Failed to check availability. Please try again with a better connection.',
  '電話番号を入力してください': 'Please enter your phone number',
  // 変更フローの下書き復元後、対象の予約が既にキャンセル・変更済みだった場合の案内（Google CEO視点
  // レビュー・ラウンド46での指摘対応）
  'この予約は既に変更またはキャンセルされているため、続行できません。お手数ですが「マイ予約」から最新の状況をご確認ください。': 'This reservation has already been changed or cancelled, so this update can’t continue. Please check "My Bookings" for its latest status.',

  // 確認画面
  '✅　ご予約内容の確認': '✅  Confirm Your Booking',
  'コース': 'Course',
  'ご来店日': 'Date',
  '時間': 'Time',
  '人数': 'Party size',
  'お名前': 'Name',
  '電話番号': 'Phone',
  'メールアドレス': 'Email',
  'ご要望': 'Notes',
  'ご指名': 'Requested staff',
  '目安': 'approx.',
  '名様': ' guests',
  '人数未定': 'Party size TBD',

  // 定期予約（シリーズ予約）
  '📅 定期予約として申し込む': '📅 Book as a recurring series',
  '毎週': 'Weekly',
  // "Biweekly"は英語圏でも「2週に1回」「週2回」の両方の意味で使われる曖昧語（ランダム客層視点
  // レビュー・ラウンド35での指摘）。他の頻度と同じ「Every N weeks」形式にして誤読を防ぐ。
  '隔週': 'Every 2 weeks',
  '毎月': 'Monthly',
  'カスタム': 'Custom',
  '間隔': 'Every',
  '週間ごと': ' weeks',
  '回数': 'Occurrences',
  '回': '',
  '申し込まれる日程': 'Dates to be booked',
  '選択した来店日を1回目として、以降を自動で申し込みます。満席等で確定できない回があった場合は、その回だけ個別にご連絡します。':
    'Your selected date will be the 1st booking; the rest will be booked automatically. If any booking can\'t be confirmed (e.g. fully booked), we\'ll contact you about that booking individually.',
  '定期予約': 'Recurring series',
  'このシリーズをまとめてキャンセル': 'Cancel entire series',
  'このシリーズの今後の予約をすべてキャンセルします。よろしいですか？': 'This will cancel all upcoming bookings in this series. Are you sure?',

  // 見積/承認フロー（テスト全部隊レビュー・2026-08-11で英訳漏れを発見、追加）
  'お見積り': 'Estimate',
  '部品代': 'Parts',
  '工賃': 'Labor',
  '承諾する': 'Approve',
  '辞退する': 'Decline',
  '承諾済み': 'Approved',
  '辞退済み': 'Declined',
  '※ 承諾・辞退いずれの場合も、ご来店予約自体はキャンセルになりません。': '※ Your booking will remain as-is whether you approve or decline this estimate.',
  'この見積を承諾します。よろしいですか？': 'This will approve the estimate. Are you sure?',
  'この見積を辞退します。よろしいですか？（ご来店予約自体は継続します）': 'This will decline the estimate. Are you sure? (Your booking will remain as-is.)',
  'ご依頼の作業が完了しました。ご都合の良い時にお引き取りにお越しください。': 'Your requested work is complete. Please come by at your convenience to pick up.',

  // 完了画面
  'ご予約を承りました': 'Your booking is confirmed',
  '変更が完了しました': 'Your booking has been updated',
  '\n\nLINEに変更確認メッセージをお送りしました。': '\n\nWe\'ve sent a confirmation message via LINE.',
  '予約番号：': 'Booking ID: ',
  '変更に失敗しました': 'Failed to update your booking',
  '通信エラーが発生しました': 'A connection error occurred',
  '\n\nLINEに確認メッセージをお送りしました。': '\n\nWe\'ve sent a confirmation message via LINE.',
  '内容を確認後、ご連絡いたします。': "We'll review the details and get back to you.",
  '貸切お申し込みを受け付けました': 'Your private-hire request has been received',
  '13名以上・人数未定（ご相談）': '13+ guests / undecided (consultation)',
  '（貸切）': ' (private hire)',
  '🔒 貸切で予約する — 本日は受付不可': '🔒 Book as private hire — unavailable today',
  '🔒 貸切で予約する': '🔒 Book as private hire',
  '💬 13名以上・大人数のご相談 — 本日は受付不可': '💬 Consult for 13+ guests — unavailable today',
  '💬 13名以上・大人数のご相談': '💬 Consult for 13+ guests',
  '人数未選択です。': 'Please select a party size.',
  '承知しました': 'I understand',
  '貸切をキャンセル': 'Cancel private-hire request',

  // マイ予約
  '📞　電話番号でご予約を確認': '📞  Find My Booking by Phone Number',
  'LINEをご利用でないため、ご予約時に入力した電話番号でご予約を検索します。': "Since you're not using LINE, please enter the phone number you used when booking.",
  'LINEをご利用でないため、ご予約時にご登録いただいたお名前・電話番号でご予約を検索します。': "Since you're not using LINE, please enter the name and phone number you used when booking.",
  '現在、確定しているご予約はございません。': 'You have no upcoming bookings.',
  '予約を確認中...': 'Checking your bookings...',
  '✕ キャンセル済み': '✕ Cancelled',
  '日程・時間を変更': 'Change Date/Time',
  'キャンセル': 'Cancel',
  '本当にキャンセルしますか？': 'Are you sure you want to cancel?',
  '処理中...': 'Processing...',
  'はい': 'Yes',
  'いいえ': 'No',
  '← 戻る': '← Back',
  '戻る': 'Back',
  '← 入力画面に戻る': '← Back to Booking Form',

  // 予約完了・エラー画面
  '送信中です...': 'Submitting...',
  '申し訳ございません': 'We apologize',
  '予約処理中にエラーが発生しました。': 'An error occurred while processing your booking.',
  '原因を特定し、早急に対応いたします。': "We're looking into it and will get back to you shortly.",
  'お手数ですが、お電話（': 'Please call us at ',
  '）または、': ' or contact us via ',
  'このLINE公式アカウントのトーク画面からご連絡ください。': 'our LINE official account chat.',
  '※ まだ確定していません。店舗からの確認のご連絡をお待ちください。': '※ Not yet confirmed. Please wait for confirmation from the restaurant.',
  '注意事項・キャンセルポリシーを確認する（タップで再表示）': 'View notes / cancellation policy (tap to show again)',
  '送信中...': 'Submitting...',
  '予約を確定する': 'Confirm Booking',
  '1名様のご予約はこの日はお受けできません': 'Solo bookings are not available on this date',
  'この日はご案内できる時間帯がありません。別の日をお選びください。': 'No available time slots on this date. Please choose another date.',

  // 予約変更フロー
  '📝　変更対象の予約': '📝  Booking to Change',
  '📅　新しいご来店日': '📅  New Date',
  '⏰　新しい来店時間': '⏰  New Time',
  '新しいご来店日を選択してください': 'Please select a new date',
  '選択された日付は予約受付期限を過ぎています': 'The selected date is past the booking deadline',
  '新しい来店時間を選択してください': 'Please select a new time',
  '確認へ': 'Review',
  '🔄　変更内容の確認': '🔄  Confirm Changes',
  '変更前': 'Before',
  '変更後': 'After',
  '伝言': 'Message',
  '変更を確定する': 'Confirm Change',
  '変更後の予約日が受付期限を過ぎている場合はキャンセル料が発生することがあります。': 'A cancellation fee may apply if the new date is past the booking deadline.',

  // キャンセル待ち・貸切満席時の案内（Apple design review対応：翻訳漏れを解消。
  // 「LINEでお知らせ」は実際にはメールでも通知されうるため、チャネルを明示しない表現に統一）
  'キャンセル待ちに登録しました。空きが出たらお知らせします。': "You've been added to the waitlist. We'll let you know if a spot opens up.",
  'この日は満席です。キャンセルが出た際にお知らせすることができます（先着順のためご案内をお約束するものではありません）。': 'This date is fully booked. We can notify you if a cancellation opens up (first-come, first-served — this does not guarantee a spot).',
  'お名前': 'Name',
  '登録中...': 'Registering...',
  'キャンセル待ちに登録する': 'Join Waitlist',
  'どのように通知しますか？': 'How should we notify you?',
  'ちょうどこの時間・担当者が空いたときだけ通知する': 'Only notify me when this exact time/staff opens up',
  '同じ日ならいつでも良いので、空きが出たら通知する': "Notify me if any slot on this day opens up",
  'この日は貸切のご予約が入っているため、貸切・大人数でのご利用はできません。': 'This date already has a private-event booking, so private/large-group bookings are not available.',
  'キャンセルが出た際にお知らせすることもできます（先着順のためご案内をお約束するものではありません）。お急ぎの場合はお電話でご相談ください。': "We can also notify you if a cancellation opens up (first-come, first-served — this does not guarantee a spot). If it's urgent, please call us.",
  'お急ぎの場合はお電話でご相談ください。': "If it's urgent, please call us.",
  'お急ぎの場合はお電話ください': "If it's urgent, please call us",

  // 予約変更フォーム
  '💬　伝言・要望（任意）': '💬  Message / requests (optional)',
  '変更に際してのご要望や伝言があればご記入ください': 'Any requests or notes about this change',

  // その他の情報（任意）：見出し・プレースホルダー。Q1/Q2の質問文言自体（q1Question/q3Question）は
  // 店舗が自由入力するコンテンツのため翻訳対象外（ファイル冒頭のコメント参照）。以前ここにあった
  // 'Q1. ご利用目的（任意）'等の固定文言辞書は、質問文言が店舗側で編集可能になった時点で
  // 呼び出し側がt()を通さなくなり、二度と参照されないデッドコードになっていたため削除した
  // （審判団バックログ一括レビューでの指摘）。
  '具体的にご記入ください': 'Please specify',
  'ご一緒される方のお名前・ご要望等（任意）': "Names / requests for guests joining you (optional)",
  'ご要望（アレルギー等、任意）': 'Requests (allergies, etc., optional)',
  '1人目はご予約の代表者様です。お名前を書かなくても「1人目」として記録されます。': 'Guest 1 is the person making this booking. They will be recorded as "Guest 1" even if no name is entered.',
  'その他のご要望（任意）': 'Other requests (optional)',
  '上記以外のご要望があればご記入ください': 'Any other requests not covered above',

  // マイ予約：期限後の変更・キャンセル依頼（「LINEで」という表現はゲスト利用者に誤解を与えるため中立表現に統一）
  'まだ確定していません（貸切・大人数のご相談中）': 'Not yet confirmed (private/large-group request pending)',
  '※ 変更・キャンセルの受付期限が過ぎています。': '※ The deadline for changes/cancellations has passed.',
  '直前の変更は基本承っておりませんが、対応できる場合もございます。': "We generally can't accommodate last-minute changes, but may be able to in some cases.",
  '依頼を送信しました。お店からのご連絡をお待ちください。': "Your request has been sent. Please wait to hear back from us.",
  '変更したい': 'Change',
  'キャンセルしたい': 'Cancel',
  'ご希望の内容（例：来店時間を19時に変更したい）': 'Details of your request (e.g. change time to 7pm)',
  '依頼を送信する': 'Send Request',
  'やめる': 'Never mind',
  '変更・キャンセルを依頼する': 'Request a Change or Cancellation',

  // カレンダー（Apple design review対応：凡例・aria-labelの英訳漏れを解消）
  '前の月': 'Previous month',
  '次の月': 'Next month',
  '満席・休業': 'Full / Closed',
  '過去の日付のため選択できません': 'Past date, cannot be selected',
  '予約可能な期間外です': 'Outside the bookable date range',
  '残席わずか': 'Few seats left',
  '空きあり': 'Available',
  '満席/休業': 'Full/Closed',
}
