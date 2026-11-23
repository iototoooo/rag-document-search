# 初期設定マニュアル

Supabase・API キー・ローカル起動・Vercel デプロイまでの手順です。上から順に進めてください。
**⚠ マークの手順は、外部サービスの変更・データ送信・課金が発生します。** 実行前に内容を確認してください。

> 画面名・メニュー名は 2026-11 時点の Supabase / Vercel のものです。表記が変わっている場合は近い名前のメニューを探してください。

---

## 0. 事前準備

| 必要なもの | 確認方法 |
| --- | --- |
| Node.js 20.9 以上 | PowerShell で `node -v` |
| リポジトリ一式と `npm install` 済み | `npm run check` が成功する |
| `samples/`（PDF 5・Markdown 5・CSV 1） | README の構成どおりに配置 |
| Supabase の開発用プロジェクト `rag-document-search` | 作成済み |
| OpenAI / Anthropic のアカウント | API キーを発行できる状態 |

## 1. Supabase プロジェクトの設定を確認する（変更なし）

1. https://supabase.com/dashboard にログインし、プロジェクト **rag-document-search** を開く。
2. 左下の **Project Settings（歯車）> General** を開く。
3. **Region** が `Northeast Asia (Tokyo)`（`ap-northeast-1`）になっていることを確認する。
   - 違う場合: リージョンは後から変更できません。開発用なので、東京リージョンで作り直すことを推奨します。
4. **Project Settings > Data API**（または API）で **Project URL** を控える（`https://xxxx.supabase.co`）。
5. **Project Settings > API Keys** で次の 2 つの場所を確認する（**値はまだコピーしない**。手順 6 で `.env.local` に直接貼り付けます）。
   - 公開用キー: `anon`（Legacy タブ）または `Publishable key`
   - 管理用キー: `service_role`（Legacy タブ）または `Secret key` … **絶対に共有・コミットしない**

## 2. ⚠ SQL を適用する（DB の変更）

### 実行順序

| 順番 | ファイル | 内容 |
| --- | --- | --- |
| 1 | `supabase/migrations/20261122000000_rag_schema.sql` | pgvector、テーブル 3 つ、RLS、検索関数、Storage バケット |
| 2 | `supabase/migrations/20261122000100_ingest_rpc.sql` | 取り込み用の関数（service_role 専用） |
| 2-b | `supabase/migrations/20261123000000_service_role_ingest_grants.sql` | 取り込み CLI（service_role）へのテーブル権限（documents・document_chunks の読み書きのみ） |
| 3 | `supabase/verify/02_security_checklist.sql` | **一括チェック（推奨）**: 41 項目の期待値・実際の値・OK/NG を 1 つの表で表示（読み取りのみ） |
| 4 | `supabase/verify/01_after_migration_checks.sql` | 個別の詳細確認（9 クエリ。読み取りのみ） |

> **SQL Editor で複数の SELECT を実行すると、結果欄には最後の 1 つ（または行のある最後の結果）しか表示されないことがあります。**
> そのため、まず `02_security_checklist.sql` を全文貼り付けて Run し、`result` 列がすべて `OK` であることを確認してください。
> `01` の各クエリを見たい場合は、`-- [1]` などの 1 ブロック（`select` から `;` まで）を **マウスで選択した状態で Run**（または Ctrl+Enter）すると、選択部分だけが実行されます。

### 手順

1. 左メニューの **SQL Editor** を開き、**New query**（+）をクリック。
2. VS Code / Cursor で `20261122000000_rag_schema.sql` を開き、**全文**をコピーして SQL Editor に貼り付ける。
3. 右下の **Run**（Ctrl+Enter）をクリック。
   - 「destructive operation」などの確認ダイアログが出た場合: 内容が上記ファイルであることを確認して実行。
   - 下部に `Success. No rows returned` と出れば成功。
4. もう一度 **New query** を開き、`20261122000100_ingest_rpc.sql` を同様に実行。続けて `20261123000000_service_role_ingest_grants.sql` も同様に実行。
5. **New query** で `02_security_checklist.sql` を貼り付けて実行。41 行の表が表示され、`result` 列が**すべて `OK`** なら正常。
   No.38〜40（データ件数）は現時点の件数を示す項目のため、取り込み・ユーザー登録後は NG 表示になるのが正常。
   NG の行があれば、その `no`・`item`・`actual` を控えて相談する（Auth 設定には進まない）。
6. 必要に応じて `01_after_migration_checks.sql` の各ブロックを 1 つずつ選択して実行し、下の期待値と照合する。
   `[8]`・`[9]` は文書・利用者が 0 件の段階では **0 行（No rows returned）が正常**。

### 適用後の期待値

| 確認 | 期待される結果 |
| --- | --- |
| [1] 拡張 | `vector` が 1 行（schema = `extensions`） |
| [2] RLS | 3 テーブルとも `rowsecurity = true` |
| [3] ポリシー | 4 件。すべて `cmd = SELECT`、`roles = {authenticated}` |
| [4] テーブル権限 | `anon` の行が **0 件**。`authenticated` は 3 テーブルとも `SELECT` のみ |
| [5] 関数 | `match_document_chunks`: definer=false / anon=false / authenticated=true。`replace_document_with_chunks`: anon=false / authenticated=false / service_role=true。`is_active_app_user`: definer=true / anon=false |
| [6] 列の型 | `vector(1536)` |
| [7] バケット | `documents` が `public = false` |

さらに画面でも確認: 左メニュー **Table Editor** で 3 テーブルに「RLS enabled」、**Storage** で `documents` バケットが **Private**。

### 失敗したときの対応

| 症状 | 原因と対応 |
| --- | --- |
| `relation "app_users" already exists` など | 途中まで適用済み。**開発用プロジェクトに限り** `supabase/verify/99_rollback_dev_only.sql` を実行して元に戻し、手順 2 からやり直す |
| `permission denied` が `storage.buckets` / `storage.objects` で出る | Storage 部分だけ失敗。エラー全文を控えて相談する（Dashboard の Storage 画面から Private バケット `documents` を作成し、ポリシーを手動設定する方法もある） |
| `type "vector" does not exist` | 拡張の作成に失敗。**Database > Extensions** で `vector` を有効化（schema: extensions）してから再実行 |
| その他のエラー | エラーより前の文は適用済みの可能性がある。確認 SQL で状態を確かめ、エラー文をそのまま控えて相談する。**API キー等をエラー報告に含めない** |

## 3. ⚠ 認証（Auth）の設定

1. **Authentication > Sign In / Providers**（または Providers）> **Email** を開く。
   - Email: 有効
   - **Allow new users to sign up: 無効**（自己登録を禁止）
   - **Confirm email: 有効**
2. **Authentication > URL Configuration**
   - Site URL: `http://localhost:3000`（Vercel 公開後に本番 URL へ変更）
3. 利用者（テスト用）を作成: **Authentication > Users > Add user > Create new user**
   - メール・パスワードを入力し、**Auto Confirm User にチェック**
   - パスワードは十分に長いものを使い、チャットや資料に書かない
4. 利用を許可: **SQL Editor** で次を実行（`<メール>` を置き換え）

```sql
insert into public.app_users (user_id, is_active, role)
select id, true, 'member' from auth.users where email = '<メール>'
on conflict (user_id) do update set is_active = true, updated_at = now();
```

5. 確認: `supabase/verify/01_after_migration_checks.sql` の [9] で `is_active = true` が 1 件。

## 4. `.env.local` を作成する

```powershell
cd <リポジトリのフォルダ>   # 例: C:\dev\rag-document-search
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }   # 既存ファイルは上書きしない
code .env.local   # または Cursor で開く
```

`.env.local` は `.gitignore` で除外されています（`git check-ignore -v .env.local` で確認できます）。
値はエディタで直接貼り付け、チャット・スクリーンショット・資料には書かないでください。

### Supabase の値の取得場所（Dashboard）

| 変数 | 取得場所 | 用途・公開範囲 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 画面上部の **Connect**、または **Project Settings > Data API** の Project URL（`https://<Project ID>.supabase.co`。末尾に `/rest/v1` を付けない） | 接続先。ブラウザに公開される |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Project Settings > API Keys** の **Publishable key**（`sb_publishable_...`）。旧形式を使う場合は **Legacy API Keys** タブの `anon` `public` | ブラウザに公開される前提のキー。RLS により、ログイン済みかつ `app_users` で許可された利用者だけが社内公開文書を読める |
| `SUPABASE_SERVICE_ROLE_KEY` | 同じ画面の **Secret key**（`sb_secret_...`、Reveal で表示）。旧形式は Legacy タブの `service_role` `secret` | **RLS を迂回する管理者用キー**。取り込み CLI（`npm run ingest`）専用。Web アプリは使わない。`NEXT_PUBLIC_` を付けない・Vercel に設定しない・ログイン確認の段階では空でよい |

> 新形式（Publishable / Secret）と旧形式（anon / service_role）はどちらでも動きます。**2 つのキーは同じ形式でそろえて**ください。
> キーを誤って共有・コミットした場合は、API Keys 画面で該当キーを無効化（ローテーション）してください。

### その他の変数

| 変数 | 値 | 備考 |
| --- | --- | --- |
| `ALLOWED_EMAIL_DOMAINS` | テストユーザーのメールの `@` より後ろ（例: `taro@corp.example.jp` → `corp.example.jp`） | 完全一致・カンマ区切りで複数可。テンプレートの `example.com` のままだと、それ以外のドメインの利用者は **ログイン後に権限なし** になる。空にすると絞り込みなし（`app_users` の登録は必須のまま） |
| `OPENAI_API_KEY` | OpenAI の API キー | 文書取り込み・検索の段階で設定（ログイン確認には不要） |
| `ANTHROPIC_API_KEY` | Anthropic の API キー | 回答生成の段階で設定（ログイン確認には不要） |

その他（`ANTHROPIC_MODEL` など）は既定値のままで構いません（第 6 章）。

### 設定の点検（外部通信なし・値は表示しない）

```powershell
npm run env:check
```

URL の形式、キーの取り違え（anon 欄に service_role キーを入れていないか等）、`ALLOWED_EMAIL_DOMAINS` を点検し、
キー名と判定結果だけを表示します。`NG` が 0 件になるまで `.env.local` を修正してください
（`SUPABASE_SERVICE_ROLE_KEY` 未設定の「注意」はログイン確認の段階では問題ありません）。

### 接続・認証テスト（API キー未設定の段階で実施できる範囲）

`.env.local` を変更したら、`npm run dev` を一度止めて（Ctrl + C）起動し直してください。

```powershell
npm run dev      # http://localhost:3000
```

| # | 操作 | 期待結果 | 違う場合 |
| --- | --- | --- | --- |
| 1 | ブラウザで `http://localhost:3000` を開く | `/login` に移動する（未ログインのため） | 画面がエラー → 上の表の URL・キーと `npm run env:check` を再確認 |
| 2 | 誤ったパスワードでログイン | ログイン失敗のメッセージ | — |
| 3 | テストユーザーで正しくログイン | チャット画面が表示される | 「利用権限がありません」→ `ALLOWED_EMAIL_DOMAINS` と `app_users` の登録（第 3 章 4・5）を確認 |
| 4 | ログアウト → ブラウザの戻るボタン／`http://localhost:3000` を再度開く | `/login` に戻される | — |
| 5 | 別のブラウザ（シークレットウィンドウ）で `http://localhost:3000/api/documents/00000000-0000-0000-0000-000000000000/file` を開く | 401（未認証） | 200 が返る場合は作業を止めて報告 |

- この段階では文書が未登録で、OpenAI / Claude の API キーも未設定のため、**質問を送信すると失敗します（正常）**。質問の確認は第 5 章（取り込み）・第 6 章（API）の後に行います。
- 確認中にターミナルへキーの値が表示されることはありません。エラー表示に含まれるのは変数名だけです。

## 5. ⚠ 文書を取り込む

```powershell
npm run ingest                 # ドライラン（外部通信なし）。5 ファイル・14 チャンク前後と表示されれば OK
npm run ingest -- --execute    # 実行: OpenAI に文書本文を送信し、Supabase に保存（課金あり・少額）
```

確認: **Table Editor > documents** に 5 行（visibility = internal）、**document_chunks** に十数行、**Storage > documents** に 5 ファイル。

## 6. API・課金の設定

### 使用するモデルと次元数

| 用途 | モデル | 設定 | 備考 |
| --- | --- | --- | --- |
| Embedding | `text-embedding-3-small` | 1536 次元（固定） | DB の `vector(1536)` と一致。別モデル・別次元は起動時エラー |
| 回答生成 | `claude-opus-5-5`（既定） | 許可リスト: `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` | Fable 等の上位モデルは設定不可 |

- モデル ID は 2026-11-03 時点の Anthropic 公式情報で提供中であることを確認済み（**実 API での疎通は未確認**）。初回は Anthropic Console の Workbench / Models 画面、または `npm run eval -- --live --execute --only 1` で確認する。

### 課金を抑える既定値

| 変数 | 既定 | 意味 |
| --- | --- | --- |
| `ANTHROPIC_EFFORT` | `low` | 思考の深さ。精度不足時のみ `medium` へ |
| `ANTHROPIC_MAX_TOKENS` | `8000` | 1 回答の出力上限（思考を含む） |
| `ANTHROPIC_MAX_RETRIES` / `OPENAI_MAX_RETRIES` | `1` | 自動再試行回数 |
| `ANTHROPIC_SERVER_FALLBACK` | `false` | 拒否時に別モデルで自動再実行しない |
| `RAG_MATCH_COUNT` | `6` | Claude に渡す資料数（多いほど入力費用が増える） |

**各社の管理画面で利用上限（Spend limit / Usage limit）を必ず設定してください**（例: 月 $5）。

### 概算費用（参考値・2026-11 時点。必ず各社の最新料金を確認）

前提: 1 質問あたり入力 約 2,000 トークン（資料 6 件 + 指示 + 質問）、出力 約 300〜1,000 トークン（思考を含む）。

| 項目 | 単価（per 1M tokens） | 1 回あたり | 12 問の検証 1 回 |
| --- | --- | --- | --- |
| Claude Opus 5.5 | 入力 $4 / 出力 $20 | 約 $0.01〜0.03 | 約 $0.15〜0.35 |
| （参考）Claude Sonnet 5.5 | 入力 $2 / 出力 $10 | 約 $0.005〜0.015 | 約 $0.1〜0.2 |
| （参考）Claude Haiku 5.5 | 入力 $0.10 / 出力 $0.50 | $0.001 未満 | 約 $0.01 |
| OpenAI text-embedding-3-small | 約 $0.02（要確認） | ほぼ 0 | 取り込み・検証あわせて $0.01 未満 |
| 最悪ケース（出力上限 8000 まで使用・Opus） | — | 約 $0.17 | 約 $2 |

- Supabase / Vercel: 開発・検証は無料プランの範囲を想定。**業務利用・顧客納品では各サービスの商用条件（有料プランの要否）を確認**。

## 7. ローカルで動かす

```powershell
npm run dev      # http://localhost:3000
```

1. `/login` でテストユーザーでログイン → チャット画面が表示される。
2. 取り込んだ文書に記載のある内容を質問する →  回答と出典（ファイル名・ページ）が表示される。
3. 出典をクリック → 新しいタブで PDF の該当ページが開く。
4. 文書に記載のない内容を質問する（例: 「社宅の家賃補助はありますか？」）→「該当する情報が見つかりません」。
5. 確認後、[精度検証記録](./EVALUATION.md) の手順で `npm run eval -- --live --execute` を実行する。

## 8. ⚠ Vercel へのデプロイ（公開操作）

### 手順

1. GitHub へ push する前に、第 9 章の「公開前の安全確認」を実施する。
2. https://vercel.com/new でリポジトリをインポート（Framework: Next.js は自動検出）。
3. **Settings > Environment Variables** に次だけを設定（**Production のみ**。Preview には設定しない: [公開前チェックリスト](./DEPLOY_CHECKLIST.md) 2 章）:
   `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`ALLOWED_EMAIL_DOMAINS`（必要なら `ANTHROPIC_*` / `RAG_*`）
   - **`SUPABASE_SERVICE_ROLE_KEY` は設定しない**（Web アプリは使わない。取り込みは管理者 PC から）
4. 関数リージョンはリポジトリの `vercel.json`（`"regions": ["hnd1"]`）で **Tokyo** に指定済み。デプロイ後に **Settings > Functions** で `hnd1` になっていることを確認する。
5. **Settings > Deployment Protection** で Preview デプロイを保護（Vercel Authentication）。
6. Deploy 後、Supabase **Authentication > URL Configuration** の Site URL を本番 URL に変更し、Redirect URLs に本番 URL を追加。

公開前の詳細な確認項目は [公開前チェックリスト](./DEPLOY_CHECKLIST.md) を参照。
`SUPABASE_SERVICE_ROLE_KEY`・`VERIFY_USER_*`・`VERIFY_UNREGISTERED_*` が Vercel に設定されていると、**ビルドが中止されます**（設定ミスの防止）。
デプロイ後の確認手順（ログイン・PDF・回答生成・セキュリティ）は [公開前チェックリスト](./DEPLOY_CHECKLIST.md) 7 章、GitHub 公開の手順は [GITHUB_PUBLISH.md](./GITHUB_PUBLISH.md)。

### デプロイ後の安全確認

```powershell
npm run verify:db -- --app-url https://<本番URL>   # 未認証アクセス・RLS・Storage（読み取りのみ）
```

- [ ] 未ログインで `https://<本番>/` → `/login` に移動する
- [ ] 未ログインで `https://<本番>/api/chat` に POST → 401
- [ ] `app_users` 未登録ユーザーでログイン → 「利用権限がありません」
- [ ] ブラウザの開発者ツール（Sources / Network）で API キー・service_role が見えない
- [ ] レスポンスヘッダーに `X-Content-Type-Options: nosniff` などが付いている
- [ ] 出典 PDF の URL をログアウト状態で開くと 401
- [ ] OpenAI / Anthropic の利用上限が設定されている

## 9. 公開前の安全確認（GitHub push 前）

```powershell
npm run build; npm run scan:secrets       # Git 管理下とブラウザ向けファイルに秘密の値がないこと
git status --short                       # 意図しないファイルがないか
git ls-files | Select-String -Pattern '\.pdf$|\.csv$|\.env|samples/|reports/'   # 何も表示されないこと
git log --format='%ae %ce' | Sort-Object -Unique   # noreply アドレスのみであること
```

- `.env.local`・PDF・CSV・`samples/`・`reports/` がコミットされていないこと
- README・docs に API キー・パスワード・実在の社内情報が含まれていないこと
