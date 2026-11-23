# チャットUI・認証（feature/ui）

## 画面構成

| パス | 内容 | アクセス |
| --- | --- | --- |
| `/login` | メールアドレス + パスワードのログイン | 誰でも |
| `/` | チャット画面（質問入力・回答・出典） | 認証 + 利用許可（`app_users.is_active`） |
| `GET /api/documents/{id}/file` | 出典 PDF（`#page=N` で該当ページ） | 認証 + 利用許可 + 文書の閲覧権限（RLS） |

- サインアップ画面はありません。アカウントは管理者が発行し、`app_users` で有効化します。
- 共通ヘッダー：アプリ名と、ログイン中のみ表示されるログアウトボタン（POST の Server Action）。
- 利用許可がないアカウントには「利用権限がありません」画面（ログアウトボタン付き）を表示します。

### チャット画面（`src/components/chat/`）

- Enter で送信、Shift+Enter で改行。IME 変換中の Enter（`isComposing` / `keyCode 229`）では送信しません。
- 送信中は二重送信を防止し、`aria-busy` と `aria-live` で読み上げにも対応します。
- 文字数カウンター（上限 `QUESTION_MAX_LENGTH`）。サーバーと同じく trim 後の長さで数えます。
- `/api/chat` の応答は `chatResponseSchema` / `apiErrorSchema`（zod）で検証してから表示します。契約に合わない応答はエラーとして扱います。
- `found=false` の回答は「該当する情報が見つかりません」と補足を表示し、出典は表示しません。
- 回答本文の `[n]` は、出典一覧に存在する番号だけを出典として強調します。本文は React のテキストとして描画し、HTML としては解釈しません（`dangerouslySetInnerHTML` は不使用）。
- 出典にはファイル名・`p.ページ`・セクション・抜粋を表示します。クリックすると `documentFileUrl(documentId, pageNumber)` を新しいタブ（`rel="noopener noreferrer"`）で開きます。
- 会話履歴は画面内の state のみに保持します。サーバー・localStorage には保存しません。
- エラー表示：401 はログイン画面への案内、403 は権限エラー、500 系ではサーバーのメッセージを表示しません（内部情報の漏えい防止）。

### スマートフォン対応

- `viewport: width=device-width, viewport-fit=cover`。入力欄は iPhone の自動ズームを避けるため 16px（`text-base`）です。
- 入力フォームは画面下部に固定し、`env(safe-area-inset-bottom)` でホームバーを避けます。
- 出典のファイル名は `break-all` で折り返し、横スクロールが出ないようにしています。
- フォントは日本語のシステムフォントを使います（外部フォントは取得しません）。

## 認証・認可フロー

```
ブラウザ ──> proxy.ts（Supabase セッション Cookie を更新。未ログインでページへ来たら /login へ）
              │  ※ /api/** はリダイレクトしない（API 自身が 401 JSON を返す）
              ▼
        ページ / Route Handler
              │ authorizeUser()（src/lib/auth/authorize.ts）
              │   1. supabase.auth.getUser() で JWT をサーバー検証
              │   2. メール確認済み
              │   3. ALLOWED_EMAIL_DOMAINS（設定時、完全一致）… 補助的な絞り込み
              │   4. app_users.is_active = true … 本来の利用許可
              ▼
        OK → 表示 / 処理　　NG → 401（未ログイン）/ 403（未許可）
```

- `proxy.ts` は楽観的チェックだけを行います。最終的な認可は、チャット画面の Server Component と各 Route Handler が `authorizeUser()` で行います。
- **ログイン（`src/lib/ui/login.ts`）:** パスワード認証に成功しても、続く `authorizeUser()` が NG なら直ちに `signOut()` します。表示するのは汎用エラーで、アカウントの有無・パスワード誤り・未許可を区別しません。
- **ログイン後のリダイレクト先（`next`）:** `sanitizeRedirectPath()` でサイト内の相対パスだけを許可します。`//host` や `/\host`、制御文字、`/login` は `/` に置き換えます。
- **Cache Components との関係:** 認可を行うコンポーネントは `<Suspense>` の中に置き、`await connection()` でリクエスト時に必ず実行します。`try/catch` 内では `unstable_rethrow()` で Next.js の制御用エラーを再送出し、ビルド時に認可結果が静的生成されないようにしています。
- 補足: `SupabaseClient` を `authorizeUser()` に直接渡すと TS2589 になるため、`src/lib/auth/server.ts` の `authorizeWithSupabase()` でキャストを 1 か所にまとめています。

## 出典 PDF の権限確認フロー（`src/app/api/documents/[documentId]/file/`）

1. `authorizeUser()` → 未ログインは 401、未許可は 403。このとき DB と Storage には一切アクセスしません。
2. `documentId` が UUID 形式でなければ 404。
3. **ユーザー権限の Supabase クライアント**（anon キー + ユーザー JWT、RLS 適用）で `documents` を取得します。
   見えない（存在しない・権限なし）場合は区別せず 404 を返し、ファイル名などは応答に含めません。
4. 同じクライアントで非公開バケット `documents` から `download()` します。Storage 側の RLS も適用され、失敗時は 404 です。
5. 200 で PDF を返します。ヘッダーは次のとおりです。
   - `Cache-Control: private, no-store`
   - `X-Content-Type-Options: nosniff`
   - `Content-Disposition: inline; filename*=UTF-8''…`（改行・引用符は除去）
   - `Content-Security-Policy: frame-ancestors 'self'`
   - `Referrer-Policy: no-referrer`
   - `Cross-Origin-Resource-Policy: same-origin`
- service_role キーは使いません。公開 URL や署名付き URL も発行しません。
- CSP の `sandbox` は、ブラウザ内蔵 PDF ビューアで表示できなくなる可能性があるため付けていません（実ブラウザでは未検証）。

## Supabase Auth 側の設定（手動）

1. **Authentication > Providers > Email**
   - Email provider を有効化
   - **Allow new users to sign up を無効化**（サインアップ不可。管理者が Invite / Create user で発行）
   - **Confirm email を有効化**（`authorizeUser()` はメール確認済みが前提）
2. **Authentication > URL Configuration**
   - Site URL: `http://localhost:3000`（本番では実 URL）
3. **利用許可の付与**（SQL Editor で、管理者が実行）

```sql
-- 1) ダッシュボードで作成したユーザーの id を確認
select id, email, email_confirmed_at from auth.users where email = 'taro@example.com';

-- 2) 利用を許可（is_active = true）
insert into public.app_users (user_id, is_active, role)
values ('<上の id>', true, 'member')
on conflict (user_id) do update set is_active = true, updated_at = now();

-- 利用停止
update public.app_users set is_active = false, updated_at = now() where user_id = '<id>';
```

4. `.env.local` の `ALLOWED_EMAIL_DOMAINS` は学習用の設定です。社内利用時は会社のドメインに置き換えてください。
   ドメインが一致するだけでは利用できず、`app_users` での有効化が必須です。

## テスト

- `src/lib/ui/ui.test.ts`: リダイレクト先の検証、proxy の判定、IME 判定、文字数、API 応答の解析（401 / 403 / 400 / 500 / 契約違反）、出典番号の分割、ログイン処理（未許可時の signOut、汎用エラー、入力検証）
- `src/app/api/documents/[documentId]/file/handler.test.ts`: 401 / 403 / 不正 ID / RLS で見えない文書（存在しない文書と同一の 404）/ DB 例外 / Storage 失敗 / 200 とヘッダー / Content-Disposition のインジェクション対策
- 単体テストでは外部サービス（Supabase）はすべてモックです。
- 実環境（2026-11-24）: PC ブラウザでのログイン・回答・出典 PDF 表示は利用者が確認済み。実 Supabase Auth のログインと Cookie セッションでの API 呼び出しは `sectest verify` で確認済み。スマートフォン実機は未確認です。
