/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // セキュリティ強化（2026-08-05、セキュリティ総点検対応）：
  // - 全ページ共通：クリックジャッキング対策（管理画面をiframeに埋め込んで見えないボタンを
  //   クリックさせる攻撃を防ぐ）とMIMEスニッフィング対策。
  // - /adminのみ：より厳格なCSP（管理画面はLIFF等の外部SDKを使わないため、スクリプト実行元を
  //   自ドメイン＋Excel出力に使うSheetJSのCDNのみに絞れる）。
  // - /（お客様画面）はLINEのLIFF SDK（static.line-scdn.net）を読み込むため、CSPでscript-srcを
  //   絞りすぎるとLIFFログイン自体が壊れるリスクがあるため、ここでは適用しない（frame-ancestors等の
  //   安全側の共通ヘッダーのみ適用）。
  // - /specも/adminと同じ厳格CSPを適用（外部SDK依存が無く、開発権限限定のドキュメントのため）。
  async headers() {
    const common = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
    const strictCsp = {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.sheetjs.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '),
    }
    return [
      { source: '/(.*)', headers: common },
      { source: '/admin', headers: [...common, strictCsp] },
      { source: '/spec', headers: [...common, strictCsp] },
    ]
  },
}
module.exports = nextConfig
