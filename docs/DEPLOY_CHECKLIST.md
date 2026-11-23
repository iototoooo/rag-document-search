# Vercel 公開前チェックリスト

社内文書検索 AI（RAG）を Vercel に公開する前後に確認する項目です。
状態の凡例: ✅ 実装済み・確認済み / 🟡 実装済み・実環境で未検証 / ⬜ 未対応（公開前に必要） / ➖ Phase 2

最終更新: 2026-11-24（ローカル + 開発用 Supabase 東京で確認。**Vercel 上では未検証**）

> Vercel のプラン・機能の提供条件は 2026-11 時点の情報です。変更されることがあるため、設定前に Vercel の公式ドキュメントで最新の条件を確認してください。

## 0. 公開前の必須事項（すべて完了するまで公開 URL を共有しない）

| # | 必須事項 | 状態 | 参照 |
| --- | --- | --- | --- |
| M-1 | OpenAI / Anthropic の利用上限・自動チャージ設定 | ✅ 利用者が確認済み（2026-11-24） | 4 章 L-1 |
| M-2 | Supabase Auth: サインアップ無効・メール確認有効 | 🟡 設定済みと報告あり。**公開直前に再確認** | 6 章 |
| M-3 | Vercel 環境変数を **Production のみ**に、許可された変数だけ登録（Preview には登録しない） | ⬜ | 1 章・2 章 |
| M-4 | Deployment Protection（Vercel Authentication・Standard Protection）が有効 | ⬜ | 2 章 |
| M-5 | Supabase URL Configuration（Site URL・Redirect URLs）を本番 URL に変更 | ⬜ | 6 章 |
| M-6 | Vercel Firewall のレート制限ルール（`/api/chat`・`/login`） | ⬜ 強く推奨（プランの上限内で設定） | 4 章 L-2 |
| M-7 | 公開後の確認（7 章）がすべて OK | ⬜ | 7 章 |

## 1. 環境変数

### 設定場所

Vercel Dashboard > 対象プロジェクト > **Settings > Environment Variables**。
各変数の **Environments は「Production」だけ**にチェックします（Preview・Development には登録しない。理由は 2 章）。
`NEXT_PUBLIC_` 以外は **Sensitive** を有効にします（登録後に画面で値を表示できなくなる）。

### Vercel に設定してよいもの

| 変数 | 必須 | 公開範囲 | 備考 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ブラウザに公開される | 接続先 URL。公開前提 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ブラウザに公開される | Publishable / anon キー。RLS と `app_users` で保護されるため公開前提 |
| `OPENAI_API_KEY` | ✅ | サーバーのみ | 質問の Embedding。Web 用に**取り込み CLI とは別のキー**を発行すると、漏えい時に片方だけ無効化できる |
| `ANTHROPIC_API_KEY` | ✅ | サーバーのみ | 回答生成。同上（Web 用の別キーを推奨） |
| `ALLOWED_EMAIL_DOMAINS` | 任意 | サーバーのみ | メールドメインの補助的な絞り込み（完全一致）。`app_users` の登録は別途必須（8 章） |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` / `ANTHROPIC_MAX_TOKENS` / `ANTHROPIC_MAX_RETRIES` / `ANTHROPIC_TIMEOUT_MS` / `ANTHROPIC_SERVER_FALLBACK` | 任意 | サーバーのみ | 省略時は既定値（Opus 5.5・low・8000・1・30 秒・false）。通常は設定不要 |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` / `OPENAI_MAX_RETRIES` / `RAG_MATCH_THRESHOLD` / `RAG_MATCH_COUNT` | 任意 | サーバーのみ | 省略時は既定値。`EMBEDDING_*` を変えると DB と不一致になるため**設定しない** |

### Vercel に設定してはいけないもの

| 変数 | 理由 | 防止策 |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | **RLS を迂回できる管理者キー**。Web アプリは使わない（取り込み CLI 専用。`src/lib/supabase/admin.ts` は `scripts/ingest.ts` からのみ読み込まれ、`server-only`） | ✅ Vercel 上のビルドで検出したら**ビルドを中止**（`src/lib/config/deploy-guard.ts`） |
| `VERIFY_USER_EMAIL` / `VERIFY_USER_PASSWORD` / `VERIFY_UNREGISTERED_EMAIL` / `VERIFY_UNREGISTERED_PASSWORD` | 実 DB 検証用のテストアカウント | ✅ 同上 |
| `NEXT_PUBLIC_` で始まる秘密の値（名前に SECRET / SERVICE_ROLE / PRIVATE / PASSWORD / API_KEY / TOKEN を含む、または値が service_role / Secret key） | ブラウザ向けファイルに埋め込まれる | ✅ 同上 |

`vercel.json` には環境変数を書きません（リポジトリに公開されるため。テストで検査）。

## 2. Preview 環境から機密データが見えないための設定

Vercel は push のたびに Preview デプロイ（`*.vercel.app` の個別 URL）を作ります。
同じ Supabase・API キーを Preview に設定すると、**レビュー前のコードが本番データに接続された状態で公開 URL を持つ**ことになります。

| # | 設定 | 効果 | 提供プラン |
| --- | --- | --- | --- |
| P-1 | 環境変数を **Production だけ**に登録（Preview には何も登録しない） | Preview は Supabase・AI API に接続できず、ページは設定エラーになる（データ・課金とも発生しない） | 全プラン |
| P-2 | **Deployment Protection > Vercel Authentication**（Standard Protection） | Preview と各デプロイ固有の URL を、Vercel チームのメンバー以外が開けなくなる | 全プラン（Hobby 含む） |
| P-3 | Supabase の Redirect URLs に `*.vercel.app` のワイルドカードを**登録しない** | Preview のドメインへ認証リダイレクトされない | — |
| P-4 | GitHub の公開リポジトリから Fork された PR では、Vercel が自動デプロイしない設定（既定）を維持 | 第三者の変更が自分のプロジェクトでビルドされない | — |
| P-5 | （任意）Preview で動作確認が必要になったら、**別の開発用 Supabase プロジェクト**と別キーを Preview に登録 | 本番データと分離 | — |

Password Protection（Pro の有料アドオン / Enterprise）や Trusted IPs（Enterprise）は、本アプリが独自にログイン必須のため必須ではありません。

## 3. 未認証アクセスの拒否

| 項目 | 状態 | 確認方法・結果 |
| --- | --- | --- |
| 未ログインでページを開くと `/login` へ転送 | ✅ ローカル | `npm run verify:db -- --app-url http://localhost:3000`（HTTP 307） |
| 未ログインで `POST /api/chat` は 401（AI API は呼ばれない） | ✅ ローカル | 同上。認可より前に Embedding・LLM を呼ばない実装 |
| 未ログインで出典 PDF（実在文書の ID）は 401 | ✅ ローカル | 同上。anon キーを付けても 401 |
| anon キーで DB（3 テーブル）・検索 RPC・取り込み RPC を使えない | ✅ 実 DB | 同上（すべて 42501） |
| Storage の一覧・ダウンロード・公開 URL で PDF を取得できない | ✅ 実 DB | 同上（公開 URL は HTTP 400、バケットは `public=false`） |
| `app_users` 未登録ユーザーはログインしても「利用権限がありません」・API は 403 | ✅ 実 DB | [T-1〜T-3 の記録](./SECURITY_TEST_T1-T3.md)（2026-11-24 合格） |
| 部署限定・restricted 文書は検索・出典・PDF に出ない | ✅ 実 DB | 同上（同一ベクトルでの検索でも漏えい 0） |
| 上記を Vercel の公開 URL で再確認 | ⬜ | 7 章 |

経路の整理（コード確認・2026-11-24）:

| 経路 | 認証 | 認可（`app_users`） | データ取得 |
| --- | --- | --- | --- |
| `/`（チャット画面） | `proxy.ts` で転送 + ページで `authorizeUser()` | ページで確認（未許可は「利用権限がありません」） | 画面は文書を直接読まない |
| `POST /api/chat` | `getUser()`（401） | `authorizeUser()`（403）→ **その後に** Embedding・検索・Claude | 利用者の JWT で RPC（RLS 適用・internal のみ） |
| `GET /api/documents/[id]/file` | `getUser()`（401） | `authorizeUser()`（403） | 利用者の JWT で `documents` と Storage（RLS・非公開バケット）。見えない文書は存在しない文書と同じ 404 |
| `/login`（Server Action） | パスワードログインのみ。サインアップ・OTP・OAuth・パスワード再設定の画面なし | ログイン直後に確認し、未許可なら `signOut` | — |
| Supabase を直接呼ぶ | anon キーのみではすべて拒否（42501） | RLS の `is_active_app_user()` | 検索 RPC は `security invoker`。取り込み RPC は service_role のみ |

## 4. レート制限・Firewall

**現状**: `/api/chat` は 1 利用者あたり 1 分 20 回の制限を**サーバープロセスのメモリ**で管理しています（`src/lib/search/rate-limit.ts`）。
Vercel は複数インスタンスで処理するため、実効値はインスタンス数 × 20 回になり、再起動でリセットされます。
攻撃できるのは `app_users` で許可されたアカウントだけなので、想定される被害は**情報漏えいではなく API 課金の増加**です。

| # | 対応策 | 効果 | 状態 |
| --- | --- | --- | --- |
| L-1 | OpenAI / Anthropic の**利用上限（月額）**・自動チャージの確認 | 被害額の上限を固定する。**最も確実** | ✅ 利用者が確認済み（2026-11-24） |
| L-2 | Vercel Firewall のレート制限ルール | IP 単位で全インスタンス共通に制限 | ⬜ 下表 |
| L-3 | 共有ストア（Upstash Redis など）でユーザー単位の制限を実装 | ユーザー単位で正確に制限 | ➖ Phase 2（外部サービスの追加が必要） |
| L-4 | `[metric:api_chat]` ログ（応答時間の内訳・トークン数）で監視 | 異常の早期発見 | 🟡 ログ出力は実装済み |
| L-5 | `/api/chat` の `maxDuration = 60` 秒 | 応答が返らないリクエストが長時間課金され続けるのを防ぐ | ✅ 実装済み（テストで検査） |

### Vercel のプラン別の対応（Dashboard > 対象プロジェクト > **Firewall**）

| 機能 | Hobby（個人・非商用） | Pro | 本アプリでの設定 |
| --- | --- | --- | --- |
| DDoS 緩和 | 自動・無料 | 自動・無料 | 設定不要 |
| カスタムルール（パス・メソッド・IP で拒否） | 利用可（ルール数に上限） | 利用可（上限が大きい） | 必要に応じて |
| **レート制限ルール** | 利用可（ルール数・対象リクエスト数に上限） | 利用可（一定量以降は従量課金） | **`/api/chat` の POST を IP あたり 20 回 / 60 秒で拒否（429）**。可能なら `/login` の POST を IP あたり 10 回 / 60 秒 |
| Attack Challenge Mode（攻撃時の一時的なチャレンジ） | 利用可 | 利用可 | 攻撃を受けたときだけ有効化 |
| Deployment Protection（Vercel Authentication・Standard） | 利用可 | 利用可 | **有効**（2 章 P-2） |
| Password Protection / Trusted IPs | 不可 | Password は有料アドオン / Trusted IPs は Enterprise | 不要（アプリ自体がログイン必須） |
| 利用規約 | **非商用の個人利用のみ** | 商用利用可 | 学習用は Hobby で可。**実際の社内利用（業務）では Pro 以上が必要** |

ルールの作成後、レート制限ルールは最初に **Log（記録のみ）** で数日動かし、正常な利用が止まらないことを確認してから **Deny** に切り替えると安全です。

## 5. 公開 URL から社内情報が見えないための条件

- [x] 全ページがログイン必須（`proxy.ts` で転送 + ページ側で `authorizeUser()`）
- [x] API・PDF はサーバー側で認証 → `app_users` で認可 → RLS 適用クライアントで取得（service_role を使わない）
- [x] PDF は非公開バケットにのみ保存し、公開 URL・署名付き URL を発行しない
- [x] `public/` には文書を置かない（テンプレートのアイコンのみ）。PDF・CSV は `.gitignore` で除外
- [x] ページ・API・PDF に `noindex`（メタデータと `X-Robots-Tag`）
- [x] ブラウザ向けファイルに秘密の値が含まれない（`npm run scan:secrets`、2026-11-24 のビルドで OK）
- [x] Vercel 上のビルドで管理者用の変数を検出したらビルド中止
- [ ] Supabase Auth: サインアップ無効・メール確認有効（M-2）
- [ ] Preview の保護（2 章 P-1・P-2）
- [ ] Supabase URL Configuration（6 章）
- [ ] 本番 URL で 7 章の確認

## 6. Supabase Auth の設定（Dashboard）

| 画面 | 項目 | 設定値 |
| --- | --- | --- |
| Authentication > Sign In / Providers > Email | Allow new users to sign up | **無効**（自己登録を禁止。公開 URL から第三者がアカウントを作れないようにする） |
| 〃 | Confirm email | 有効 |
| 〃 | パスワードの最小長 | 12 文字以上を推奨 |
| Authentication > URL Configuration | **Site URL** | `https://<本番ドメイン>`（例: `https://<プロジェクト名>.vercel.app`） |
| 〃 | **Redirect URLs** | `https://<本番ドメイン>/**` のみ。**`https://*.vercel.app/**` のようなワイルドカードは登録しない**。同じ Supabase をローカル開発にも使う間は `http://localhost:3000/**` を残してよい |
| Authentication > Rate Limits | サインイン試行の制限 | 既定値以上の厳しさを維持 |

本アプリはパスワードログインのみで、メール内リンク（招待・パスワード再設定・Magic Link）の受け口となる画面を持ちません。
そのため利用者は **Create new user + Auto Confirm User** で作成し（[運用手順書](./OPERATIONS.md) 1 章）、招待メールは使いません。
Redirect URLs は「Supabase から送られるメールのリンク先」を本番ドメインに限定する意味で設定します。

## 7. デプロイ後の確認手順

### 7-1. 設定の確認（課金なし）

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | Vercel > Deployments > 本番デプロイ > Build Logs | ビルド成功。「公開環境の環境変数に問題があるため、ビルドを中止しました」が出ていない |
| 2 | Vercel > Settings > Functions（または Deployment の Functions タブ） | リージョンが `hnd1`（Tokyo） |
| 3 | `curl.exe -sI https://<本番ドメイン>/login` | `X-Content-Type-Options: nosniff`・`X-Frame-Options: SAMEORIGIN`・`X-Robots-Tag: noindex, nofollow`・`Referrer-Policy` があり、`X-Powered-By` がない |
| 3b | `curl.exe -s -D - -o NUL -X POST https://<本番ドメイン>/api/chat` | 401。`x-vercel-id` の最後の `::` の直前（関数の実行リージョン）が `hnd1` |
| 4 | Preview の URL（Deployments の一覧から）をシークレットウィンドウで開く | Vercel のログイン画面が出る（P-2） |

### 7-2. 未認証アクセスの拒否（課金なし・読み取りのみ）

```powershell
npm run verify:db -- --app-url https://<本番ドメイン>
```

`.env.local` の `VERIFY_USER_*` が空なら、ログイン済みユーザーの項目は SKIP になり、未認証の項目（転送 307・`/api/chat` 401・PDF 401・anon キーでの DB / Storage 拒否）だけを確認します。期待: NG 0 件。

### 7-3. ログイン・PDF 閲覧（ブラウザ・課金なし）

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 未ログインで `https://<本番ドメイン>/` を開く | `/login` に移動 |
| 2 | 登録済みユーザーでログイン | チャット画面が表示される |
| 3 | 開発者ツール（Network / Sources）で `OPENAI`・`ANTHROPIC`・`service_role`・`sb_secret` を検索 | 見つからない |
| 4 | ログアウトし、出典 PDF の URL（`/api/documents/<ID>/file`）を直接開く | 401 |

### 7-4. 回答生成（⚠ 課金あり: 2 問で 約 $0.05 以下）

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 1 | 登録済みユーザーで、文書に記載のある質問を 1 問（取り込んだ文書の内容から選ぶ） | 出典付きで回答。出典をクリックすると PDF の該当ページが開く |
| 2 | 文書に記載のない質問を 1 問（例: 社宅の家賃補助） | 「該当する情報が見つかりません」・出典なし |
| 3 | Vercel > Logs で `[metric:api_chat]` を確認 | 応答時間の内訳とトークン数だけが出ており、質問文・回答・キーが出ていない |
| 4 | OpenAI / Anthropic の Usage 画面 | 想定どおりの小さな使用量 |

### 7-5. 最終確認

- [ ] `npm run scan:secrets`（公開リポジトリと手元のビルドに秘密の値がない）
- [ ] Vercel Firewall のレート制限ルールが有効（最初は Log、問題なければ Deny）
- [ ] 確認で使ったテスト用の値を `.env.local` から消した

（任意）未登録ユーザーの拒否を本番 URL でも確かめる場合は、[T-1〜T-3 の手順](./SECURITY_TEST_T1-T3.md)の T-1 部分（Auth ユーザーの追加・削除）を再度承認のうえ実施します。アプリと DB は開発時と同じため、必須ではありません。

## 8. メールドメインの設定について

- 現在の `ALLOWED_EMAIL_DOMAINS` は**学習用の設定**（個人向けメールサービスのドメイン）です（2026-11-24 確認。値は記載しない）。
- 個人向けメールのドメインは誰でもアドレスを作れるため、**この設定による絞り込み効果はありません**。第三者の利用を防いでいるのは「サインアップ無効（M-2）」と「`app_users` への登録が必須」の 2 点です。
- 実際の社内利用に切り替えるときの追加対策:
  1. `ALLOWED_EMAIL_DOMAINS` を会社のドメインに変更する
  2. 学習用のテストユーザーを `app_users` で無効化し、Auth からも削除する
  3. SSO（SAML / Google Workspace 等）と MFA を導入する（Phase 2）
  4. 別の Supabase プロジェクト（本番用）を作り、開発用と分ける

## 9. 状態のまとめ

| 区分 | 項目 |
| --- | --- |
| ✅ 実装済み・確認済み | RLS（anon 拒否・認証済みユーザーは internal のみ）、実 pgvector 検索、認証済みユーザーの PDF 取得、未登録ユーザーの拒否（T-1）、部署限定・restricted 文書の非表示（T-2・T-3）、検索・取り込み RPC の権限、非公開 Storage、未認証の 401 / 転送、秘密情報の混入なし（全コミット履歴を含む）、管理者キーを Vercel に置くとビルド中止、noindex、応答時間とトークン数のログ、東京リージョン指定（`vercel.json`）、`maxDuration`、API の利用上限 |
| 🟡 実装済み・実環境で未検証 | 本番 URL での動作、Tokyo リージョンでの応答時間、サインアップ無効の再確認 |
| ⬜ 未対応（公開前に必要） | Vercel 環境変数（Production のみ）、Deployment Protection、Firewall のレート制限、Supabase の URL 設定、本番 URL での確認 |
| ➖ Phase 2 | 共有ストアによるレート制限、監査ログ、SSO・MFA、部署別アクセス制御の本番運用 |
