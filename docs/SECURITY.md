# セキュリティ設計書

| 項目 | 内容 |
| --- | --- |
| 対象 | 社内文書検索AI（RAG）Phase 1 MVP |
| 最終確認日 | 2026-11-24（コード・SQL レビュー + 開発用 Supabase 東京での実環境確認。Vercel 上では未確認） |
| 注意 | 本書は設計と確認結果の記録であり、SOC2 等の認証取得や規格への完全準拠を保証するものではありません。 |

## 1. 基本方針

1. **多層防御**: アプリ（認可チェック）と DB（RLS）の両方で閲覧範囲を制限する。アプリにバグがあっても DB が漏えいを防ぐ。
2. **最小権限**: ブラウザ・API は利用者本人の権限（anon キー + 利用者 JWT）で動く。RLS を迂回する service_role は取り込み CLI だけが使う。
3. **フェイルクローズ**: 認可判定でエラーが起きたら拒否する。
4. **存在を隠す**: 権限のない文書と存在しない文書は区別せず 404。検索結果にも件数にも現れない。
5. **データ最小化**: 質問・回答・文書本文・秘密情報をログに残さない。

## 2. 認証・認可

| 段階 | 内容 | 実装 |
| --- | --- | --- |
| 認証 | Supabase Auth（メール + パスワード）。サインアップ無効、メール確認必須 | `src/app/(auth)/login/` |
| セッション検証 | `getUser()` で JWT を Supabase Auth に問い合わせて検証（`getSession()` は信頼しない） | `src/lib/auth/authorize.ts` |
| 利用許可 | `app_users.is_active = true` の行が必須。ドメイン一致（`ALLOWED_EMAIL_DOMAINS`）は補助的な絞り込みのみ | 同上 |
| API | `/api/chat`・`/api/documents/*` は処理の最初に認可。失敗時は Embedding・検索・LLM・Storage を一切呼ばない | 各 `handler.ts` |
| ページ | `proxy.ts` は未ログイン時のリダイレクト（楽観的チェック）のみ。最終判断は各ページ・API | `src/proxy.ts` |

## 3. データベース（RLS）

| 対象 | 設定 |
| --- | --- |
| RLS | `app_users`・`documents`・`document_chunks` の 3 テーブルすべてで有効 |
| ポリシー | すべて `SELECT` のみ・`authenticated` 限定。書き込みポリシーなし（= 利用者は書き込めない） |
| 文書の閲覧範囲 | `visibility = 'internal'` かつ `is_active_app_user()` のときだけ。`department` / `restricted` を許可するポリシーは存在しない。既定値は最も厳しい `restricted` |
| チャンク | 親文書が見える場合のみ見える（ポリシー内のサブクエリにも documents の RLS が適用される） |
| テーブル権限 | `anon` は全権限剥奪。`authenticated` は SELECT のみ（Supabase 既定の ALL 付与を打ち消し） |
| 検索 RPC | `match_document_chunks` は `security invoker`・`search_path` 固定。呼び出し者の権限で実行されるため RLS を迂回しない。`anon` は実行不可。件数上限 20 |
| 取り込み RPC | `replace_document_with_chunks` は `service_role` のみ実行可 |
| security definer | `is_active_app_user()` の 1 つだけ。参照するのは呼び出し者自身の `app_users` 行のみ、`search_path` 固定 |
| Embedding | `vector(1536)`。アプリ側も `text-embedding-3-small`・1536 次元以外を設定できない |

これらは `tests/sql/migrations.test.ts` で静的に検査し、実 DB では `supabase/verify/01_after_migration_checks.sql` で確認する。

## 4. 文書ファイル（Storage）

- バケット `documents` は **非公開**（`public = false`）。公開 URL・署名付き URL は発行しない。
- 閲覧は `GET /api/documents/{id}/file` 経由のみ。認可 → RLS 適用クライアントで文書取得 → 同じクライアントで Storage から取得 → サーバーから返す。
- Storage のポリシーは「閲覧可能な文書の `storage_path` に一致するオブジェクト」だけを読み取り可。書き込みポリシーなし（service_role のみアップロード）。
- レスポンスヘッダー: `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: frame-ancestors 'self'` など。

## 5. 秘密情報の管理

| 秘密情報 | 使用箇所 | 置き場所 |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | 取り込み CLI のみ（`src/lib/supabase/admin.ts`、`server-only`） | 管理者 PC の `.env.local` のみ。**Vercel には設定しない** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | サーバー側（Route Handler・CLI） | `.env.local` / Vercel の環境変数（`NEXT_PUBLIC_` を付けない） |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | ブラウザ・サーバー | 公開前提（RLS で保護） |

- `.env*`（`.env.example` を除く）・認証情報ファイル・`samples/`・PDF・CSV・評価結果（`reports/`）は `.gitignore` で除外。
- コードで確認済み: service_role を参照するのは `admin.ts` と `scripts/ingest.ts` のみ。ブラウザに公開される環境変数は `NEXT_PUBLIC_SUPABASE_URL`・`NEXT_PUBLIC_SUPABASE_ANON_KEY` のみ。

## 6. LLM 関連の対策

- **プロンプトインジェクション**: 資料は `<source>` 要素でデータとして渡し、資料・質問中の区切りタグ（`source` / `sources` / `question`）を無害化。資料内の指示に従わないようシステムプロンプトで指示。
- **ハルシネーション**: 検索結果 0 件なら LLM を呼ばない。構造化出力で `found` を返させ、出典番号はサーバー側の一覧と照合。有効な出典 0 件なら「該当する情報が見つかりません」。
- **費用の暴走防止**: モデル許可リスト、effort 上限 `high`、出力上限 8000 トークン、再試行 1 回、タイムアウト 30 秒、サーバー側フォールバックは既定で無効、利用者ごとのレート制限（1 分 20 回）。
- **外部送信**: 質問と検索で得た文書抜粋が OpenAI / Anthropic に送信される。MVP はダミー文書のみ。

## 7. Web アプリ

- 全ページ共通ヘッダー: `X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options: SAMEORIGIN`、`Permissions-Policy`、`X-Powered-By` 非表示。
- `/api/chat` は `application/json` のみ受け付け（クロスサイトからの単純リクエストを防ぐ）、本文 16KB 上限、入力 1000 文字上限。
- 回答はテキストとして描画（`dangerouslySetInnerHTML` 不使用）。出典リンクは `rel="noopener noreferrer"`。
- ログイン後のリダイレクト先は相対パスのみ（オープンリダイレクト対策）。ログイン失敗理由は区別しない。

## 8. 2026-11-22 のレビュー結果

### 修正済み

| # | 内容 | 対応 |
| --- | --- | --- |
| S-1 | `authenticated` への権限剥奪が INSERT/UPDATE/DELETE/TRUNCATE のみで、REFERENCES/TRIGGER が残る | `revoke all` 後に SELECT のみ付与するよう変更（RLS があるため実害はなかった） |
| S-2 | 質問文に `</question>` などを含めるとプロンプトの区切りを崩せた | `sources` / `question` タグも無害化 |
| S-3 | 自動フォールバック・再試行・出力上限が既定で大きく、費用が想定より増える余地 | 上限付きの環境変数に変更（第 6 章） |
| S-4 | 共通のセキュリティヘッダーがない | `next.config.ts` に追加 |

### 実環境チェックの記録

| 日付 | 内容 | 判定 | 対応 |
| --- | --- | --- | --- |
| 2026-11-22 | マイグレーション 2 本を開発用 Supabase に適用。`02_security_checklist.sql`（当時 39 項目）で 38 項目 OK、**No.30 のみ NG** | **セキュリティ上の問題ではない**（確認 SQL の想定漏れ） | 下記 |

- **NG の内容**: No.30 は「public スキーマの security definer 関数は `is_active_app_user` の 1 件のみ」を件数で判定していたが、実際は 2 件だった。
- **原因**: 2 件目の `rls_auto_enable` は、Supabase が提供する「新規テーブルで RLS を自動有効化する」ためのイベントトリガー関数（owner: postgres、security definer、`search_path = pg_catalog`）。本システムのマイグレーションが作ったものではなく、確認 SQL がこの関数の存在を想定していなかった。`is_active_app_user` は設定どおり（definer・`search_path` 空）だった。
- **評価**: `rls_auto_enable` はイベントトリガー専用の関数（戻り値 `event_trigger`）で、API（RPC）から直接呼び出せない。`search_path` も固定されており、本システムの閲覧制御を弱めるものではない。むしろ RLS の付け忘れを防ぐ方向の設定。
- **確認 SQL の修正**（Supabase の関数は削除・変更していない）:
  - No.30: 件数ではなく**許可リスト方式**に変更。`is_active_app_user()`・`rls_auto_enable()`（いずれも引数なし）以外の security definer 関数が public にあれば、その「関数名(引数)」を表示して NG。
  - No.31（新設）: `rls_auto_enable` が存在する場合、security definer・`search_path=pg_catalog` 固定・イベントトリガー関数であることを個別に検証（存在しないプロジェクトでは OK）。
  - `is_active_app_user` の設定は従来どおり No.27〜29（definer・`search_path` 空・anon 実行不可）で検証。
  - 項目数は 40 になった。修正後の確認 SQL で 40 項目すべて OK を確認済み（利用者の報告）。

| 日付 | 内容 | 判定 | 対応 |
| --- | --- | --- | --- |
| 2026-11-23 | `npm run ingest -- --execute` が 5 ファイルとも失敗。読み取り専用の診断で、service_role による `documents` の SELECT が `42501 permission denied` | **閲覧制御の欠陥ではない**（権限付与の不足。失敗側に倒れていた） | 下記 |

- **原因**: 最初のマイグレーションは `anon`・`authenticated` の権限を剥奪し、`authenticated` に SELECT だけを付与していた。このプロジェクトでは public テーブルに **service_role への既定権限が付与されていなかった**ため、取り込み CLI が documents を読めなかった。確認 SQL も service_role のテーブル権限を検査していなかった（想定漏れ）。
- **影響**: 最初の Supabase 読み取りの時点で失敗したため、**OpenAI への送信・課金、Storage へのアップロード、DB への書き込みはいずれも発生していない**。
- **対応**:
  - `20261123000000_service_role_ingest_grants.sql` を追加。service_role に `documents`・`document_chunks` の SELECT/INSERT/UPDATE/DELETE だけを付与（`app_users` と anon/authenticated の権限は変更しない）。
  - 確認 SQL に No.41（service_role の 4 権限 × 2 テーブル。不足分を列挙）を追加し、41 項目になった。
  - 適用と再確認は利用者が SQL Editor で実施（2026-11-23 適用済み。その後の取り込みが成功し、`verify:db` の service_role 確認も OK）。

### 残る懸念点（隠さず記載）

| # | 懸念 | 影響 | 推奨対応 |
| --- | --- | --- | --- |
| R-1 | レート制限がプロセス内メモリのため、Vercel の複数インスタンスでは効かない | 大量リクエストによる API 課金 | Vercel Firewall のレート制限、または Upstash 等の共有ストア。各 API の利用上限（Spend limit）設定 |
| R-2 | 文書を更新すると古い PDF が Storage に残る | 利用者からは読めない（どの文書行とも一致しないため）が、データ最小化の観点で不要データが残る | 管理者が Dashboard で削除（[運用手順書](./OPERATIONS.md)）。Phase 2 で自動化 |
| R-3 | HNSW インデックスは RLS の絞り込みを後から適用するため、見えない文書が大量にあると上位件数が減る | 部署限定文書を増やしたときの検索漏れ | pgvector の iterative scan 設定、部署別インデックス（Phase 2） |
| R-4 | 文書抜粋と質問が外部 API に送信される | 実在文書の場合の情報管理 | 実文書投入前に各社のデータ保持・学習利用の条件を確認し、社内承認を得る |
| R-5 | ログイン試行のブルートフォース | アカウント乗っ取り | Supabase Auth のレート制限確認、強いパスワード、MFA・CAPTCHA（Phase 2） |
| R-6 | 監査ログ（誰がどの文書を見たか）を残していない | 事後調査が難しい | 本文を含まないアクセスログの設計（Phase 2） |
| R-7 | 出典 PDF に CSP `sandbox` を付けていない | ブラウザ内蔵ビューアとの互換性を優先 | 実ブラウザで確認のうえ再検討 |
| R-8 | `ALLOWED_EMAIL_DOMAINS` が学習用の設定（個人向けメールサービスのドメイン） | 誰でもアドレスを作れるドメインのため絞り込み効果はない（第三者の利用はサインアップ無効と `app_users` 登録で防いでいる） | 社内利用時は会社のドメインに変更し、SSO・MFA を導入（[公開前チェックリスト](./DEPLOY_CHECKLIST.md) 8 章） |
| R-9 | 取り込み CLI を使う管理者 PC に service_role キーがある | 漏えい時は RLS を迂回される | PC の管理、漏えい時は即時ローテーション（[運用手順書](./OPERATIONS.md)） |
| R-10 | （解消）認証済みユーザー・未登録ユーザー・部署限定文書の実 DB 検証 | — | 9 章の T-0〜T-3 で確認済み（2026-11-24）。本番 URL での再確認（T-5）のみ残る |
| R-12 | Preview デプロイに本番と同じ環境変数を設定すると、レビュー前のコードが本番データに接続された URL を持つ | 未レビューのコードによる漏えい・課金 | 環境変数は Production のみ、Deployment Protection を有効化（[公開前チェックリスト](./DEPLOY_CHECKLIST.md) 2 章） |
| R-11 | レート制限が複数インスタンスで共有されない（R-1 の詳細） | 課金の増加（情報漏えいではない） | [公開前チェックリスト](./DEPLOY_CHECKLIST.md) 4 章（利用上限・Vercel Firewall） |

## 9. 実環境での確認

### 確認済み（2026-11-23・開発用 Supabase 東京 + ローカルアプリ）

`npm run verify:db -- --app-url http://localhost:3000`（読み取り専用・AI API なし）: 1 回目 **OK 16 / NG 0 / SKIP 1**、テストユーザー設定後の 2 回目 **OK 25 / NG 0 / SKIP 0**

- [x] **認証済みユーザー（T-0）**: `app_users` は自分の 1 行だけ見える、見える文書 5 件はすべて internal（internal 全件と一致）、見えるチャンク 14 / 14、**実 pgvector 検索**（既存チャンクの Embedding で検索し、自分自身が 1 位・類似度 1.0000、14 件・146 ms、範囲外の文書 0 件）、取り込み RPC は拒否（42501）、internal 文書の PDF を RLS 経由で取得できる

- [x] 確認 SQL `02_security_checklist.sql` が全項目 OK（利用者が SQL Editor で実施）
- [x] 文書 5 件はすべて `internal`、チャンク 14 件、Storage バケットは `public=false`
- [x] anon キーのみでは `documents`・`document_chunks`・`app_users` を読めない（42501）
- [x] anon キーでは検索 RPC・取り込み RPC を実行できない（42501）
- [x] anon キーでは Storage の一覧が 0 件、PDF のダウンロード不可、公開 URL は HTTP 400
- [x] 未ログインでトップは `/login` へ転送（307）、`/api/chat` と出典 PDF API（実在 ID・anon キー付きでも）は 401
- [x] セキュリティヘッダー（nosniff・X-Frame-Options）
- [x] 画面からの手動確認: ログイン、回答生成、出典 PDF 表示、記載なし質問で「該当する情報が見つかりません」（利用者が実施）
- [x] `npm run scan:secrets`: Git 管理下 127 ファイル・ブラウザ向けビルド 17 ファイルに、service_role・OpenAI・Anthropic のキーの値・形式なし
- [x] Supabase のリージョンが東京（利用者の報告）

### 実施計画と状態

| # | 検証 | 必要な操作 | DB の変更 | 状態 |
| --- | --- | --- | --- | --- |
| T-0 | 認証済みユーザーで RLS・**実 pgvector 検索**・PDF 取得 | `.env.local` に `VERIFY_USER_EMAIL` / `VERIFY_USER_PASSWORD` を設定して `npm run verify:db` | なし（ログイン記録が残るのは画面ログインと同じ。終了時にその端末のセッションだけログアウト）。検索は既存チャンクの Embedding を使い AI API を呼ばない | ✅ 2026-11-23 実施（9 項目すべて OK） |
| T-1 | `app_users` 未登録ユーザーの拒否（DB・Storage・API 403・画面） | [T-1〜T-3 手順と記録](./SECURITY_TEST_T1-T3.md)。Dashboard で未登録ユーザーを 1 人作成 → `npm run sectest -- verify` | **あり**（Auth ユーザー 1 人の追加・削除） | ✅ 2026-11-24 合格 |
| T-2 | 部署限定（`department`）文書が見えない（一覧・件数・ID 指定・検索・出典・Storage・PDF API） | 同上。`npm run sectest -- setup --execute` でダミー文書を作成（合成 Embedding・AI API なし） | **あり**（文書 1・チャンク 1・Storage 1 の追加・削除） | ✅ 2026-11-24 合格 |
| T-3 | `restricted` 文書が見えない（同上） | 同上 | **あり**（同上） | ✅ 2026-11-24 合格 |
| T-4 | 検証後の後片付け | `npm run sectest -- cleanup --execute`（記録した ID のみ削除・前後の件数照合）、Dashboard でユーザー削除 | **あり**（削除） | ✅ テストデータ削除済み・文書 5 / チャンク 14 に復帰（T-1 の Auth ユーザーは利用者が削除予定） |
| T-5 | 本番 URL での再確認 | Vercel 公開後に `npm run verify:db -- --app-url https://<本番URL>` | なし | 公開後 |

T-2・T-3 は「部署限定文書は権限チェックの実装・検証が完了するまで利用対象にしない」方針のため、**本番データには入れず、開発用プロジェクトでダミー文書を使う**。
現在の RLS は `visibility = 'internal'` だけを許可しているため、department / restricted は全利用者から見えない設計（静的テスト・確認 SQL で確認済み）。T-2・T-3 はそれを実データで裏付けるもの。
