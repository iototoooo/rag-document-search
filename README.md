# 社内文書検索AI（RAG）— 学習用MVP

社内文書（PDF）を取り込み、質問に対して関連箇所を検索し、**社内文書だけを根拠に出典（ファイル名・ページ）付きで回答**する学習用の RAG アプリです。
文書に書かれていない質問には「該当する情報が見つかりません」と答えます。

**学習用のダミー資料のみを使用します。実在の社内文書は取り込まないでください。**

## 本番環境

| 項目 | 内容 |
| --- | --- |
| 本番 URL | https://rag-document-search-amber.vercel.app （**ログイン必須**。アカウントは管理者が発行し、自己登録はできません） |
| デプロイ | GitHub の `main` ブランチを Vercel の Production にデプロイ |
| ソースコード | https://github.com/iototoooo/rag-document-search |

## 現在の状態（2026-11-24）

| 区分 | 内容 |
| --- | --- |
| ✅ 完了（実環境で確認） | GitHub への公開、Vercel 本番へのデプロイ、本番 URL でのログイン・回答生成・出典 PDF 表示、未ログインで出典 PDF の URL を開いても表示されないこと |
| ✅ 完了（実環境で確認） | Supabase への SQL 適用・文書 5 件（14 チャンク）の取り込み、実 DB での権限確認（未認証・未登録ユーザーの拒否、部署限定・restricted 文書の非表示: [T-1〜T-3](docs/SECURITY_TEST_T1-T3.md) 31/31 合格） |
| ✅ **正答率 100%（12/12）** | 文書に記載のある 10 問すべて正答、記載のない 2 問はすべて「該当なし」（2026-11-23・実 API 1 回。**学習用サンプル 5 文書・テスト質問 12 問での実測**で、他の文書や本リポジトリの架空データで同じ結果を保証するものではありません。[EVALUATION.md](docs/EVALUATION.md)） |
| ⚠ **未達** | 応答時間 5 秒以内: 実測は**中央値 2.0 秒・最大 7.7 秒**で、12 問中 1 問が 5 秒を超えました（p95 7.7 秒）。原因は未特定で、再測定は未実施です。測定はローカルで行い、Vercel 本番での応答時間は未測定です |
| ⬜ 未実施 | PDF 200 件規模での取り込み（学習用サンプル 5 件で検証。200 件規模の取り込みは行っていません）、スマートフォン実機での確認 |

詳細は [docs/DELIVERY_CHECKLIST.md](docs/DELIVERY_CHECKLIST.md)。

## 資料

| 資料 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 納品資料の一覧（ここから辿れます） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ図（構成図・シーケンス図・ER 図）と共通仕様 |
| [docs/SETUP.md](docs/SETUP.md) | 初期設定マニュアル（Supabase・API・Vercel） |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 利用者向け操作マニュアル |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 管理者向け運用手順（PDF 追加・更新・再 Embedding を含む） |
| [docs/EVALUATION.md](docs/EVALUATION.md) | 精度検証の方法と結果（正答率・該当なし・応答時間） |
| [docs/SECURITY.md](docs/SECURITY.md) | セキュリティ設計書（確認結果・残る懸念点） |
| [docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md) | Vercel 公開チェックリスト（環境変数・Preview の保護・Firewall・公開後の確認） |
| [docs/PHASE2_PROPOSAL.md](docs/PHASE2_PROPOSAL.md) | Phase 2 提案書・概算見積もり |
| [docs/RETROSPECTIVE.md](docs/RETROSPECTIVE.md) | 振り返り（開発・デプロイで難しかった点と学び） |

## 技術構成

| 役割 | 採用技術 |
| --- | --- |
| フロントエンド / API | Next.js 16（App Router）+ TypeScript + Tailwind CSS |
| DB・ベクトル検索・認証・ファイル | Supabase（PostgreSQL + pgvector + Auth + Storage）、東京リージョン（Northeast Asia (Tokyo)・`ap-northeast-1`。2026-11-24 に管理画面で確認済み） |
| ホスティング | Vercel（関数リージョンを東京 `hnd1` に `vercel.json` で指定。関数が実際に `hnd1` で動いているかは管理画面で未確認） |
| Embedding | OpenAI `text-embedding-3-small`（1536 次元・固定） |
| 回答生成 | Claude API（既定 `claude-opus-5-5`、effort `low`。許可リスト: opus / sonnet / haiku 5.5） |
| PDF 解析 | unpdf |
| テスト | Vitest（外部サービスはすべてモック。実環境の確認は `verify:db`・`sectest`・`eval --live` で別途実施） |

構成図・シーケンス図・ER 図は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 処理の流れ

1. **取り込み**: PDF → ページ単位でテキスト抽出 → 正規化（NFKC・部首補助）→ 見出し・段落を考慮したチャンク分割 → Embedding → pgvector に保存（同じ内容の再取り込みはスキップ）
2. **検索・回答**: ログイン・利用許可の確認 → 質問を Embedding → 利用者の権限（RLS）で類似チャンク検索 → Claude が根拠付きで回答 → 出典番号をサーバー側で検証
3. **UI**: Supabase Auth でログイン → チャット画面 → 出典クリックで権限確認のうえ PDF の該当ページを表示

## 必要な環境

- Windows 10/11（PowerShell）
- Node.js 20.9 以上（開発時は v24 で確認）
- Git 2.40 以上

## 起動手順（PowerShell）

```powershell
cd <リポジトリのフォルダ>            # 例: C:\dev\rag-document-search
npm install
Copy-Item .env.example .env.local   # 値を設定（Git には含まれません）
npm run dev                          # http://localhost:3000
```

> `.env.local` 未設定でもビルドは通りますが、ログインやチャットには Supabase・各 API キーの設定が必要です（[docs/SETUP.md](docs/SETUP.md)）。

## コマンド

| コマンド | 内容 | 外部通信・課金 |
| --- | --- | --- |
| `npm run dev` | 開発サーバー起動 | 画面操作に応じて発生 |
| `npm run typecheck` | 型チェック（`next typegen` + `tsc`） | なし |
| `npm run lint` | ESLint | なし |
| `npm run test` | Vitest（全テスト） | なし |
| `npm run check` | 型チェック + lint + テスト | なし |
| `npm run build` | 本番ビルド | なし |
| `npm run ingest` | 取り込みの**ドライラン**（モック・インメモリ） | なし |
| `npm run ingest -- --execute` | 実 OpenAI + Supabase へ取り込み | **あり** |
| `npm run eval` | 精度検証（**モック**: 検索ヒット率・配線のみ） | なし |
| `npm run eval -- --live --execute [--only 11,12]` | 精度検証（**実 API**: 正答率・応答時間） | **あり** |
| `npm run env:check` | `.env.local` の設定点検（値は表示しない） | なし |
| `npm run scan:secrets` | Git 管理下・ブラウザ向けビルドへの秘密情報の混入検査 | なし |
| `npm run verify:db [-- --app-url <URL>]` | 実 DB・アプリの権限確認（読み取りのみ） | Supabase への読み取り |
| `npm run sectest` | 実環境セキュリティテスト T-1〜T-3（既定は確認のみ。`--execute` で DB 変更） | Supabase（⚠ 要承認） |

## 文書・テストデータについて

- このリポジトリには **PDF・質問 CSV などの文書データを含めていません**（`samples/` は `.gitignore` で除外）。精度検証は学習用サンプル（5 文書・テスト質問 12 問）で行いましたが、その文書・質問・回答は含めていません。
- 自動テストは、テスト用に作った**架空の会社「サンプル株式会社」の規程**（`tests/fixtures/demo-corpus.ts`）で、取り込み → 検索 → 回答 → 出典の流れと評価ロジックを検証します。外部通信はありません。
- 自分の文書で試す場合は、次の構成で配置します（Git には含まれません）。

```
samples/
├─ pdf/        取り込む PDF（ファイル名は英数字・ハイフン・アンダースコア）
└─ questions/  test-questions.csv（列: 番号,質問,期待される回答,出典文書,出典セクション,種別）
```

- 取り込み: `npm run ingest -- --dir samples/pdf`（ドライラン）。評価: `npm run eval`（別のファイルは `--pdf-dir`・`--csv` で指定）。

## 開発の進め方（参考）

開発時は Git Worktree で 3 機能（取り込み `feature/ingest`・検索と回答 `feature/search`・UI と認証 `feature/ui`）を並列に実装し、`main` に統合しました。
3 ブランチはすべて `main` に統合済みのため、公開リポジトリには `main` だけを置きます。担当範囲の分け方は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

## セキュリティ方針（要約）

- 認可はサーバーで `getUser()` + `app_users.is_active` を確認（メールドメインの一致だけでは許可しない）
- 全テーブルで RLS を有効化。検索関数は `security invoker` で RLS を迂回しない。部署限定・restricted 文書は MVP では誰にも見えない
- PDF は非公開バケットに保存し、権限確認後にサーバーから返す（公開 URL なし）
- `SUPABASE_SERVICE_ROLE_KEY` は取り込み CLI のみが使用（Vercel には設定しない。設定されているとビルドを中止）。API キーは `.env.local` のみ
- 質問・本文・秘密情報をログに出さない。モデル許可リスト・再試行・出力上限で課金を制御
- PDF / CSV / `samples/` / `reports/` / `.env*` は Git 管理外。コミットは GitHub の noreply アドレスで作成

本番環境での実施状況（2026-11-24）:

| 対策 | 状況 |
| --- | --- |
| Vercel の環境変数 | ✅ 5 件を Production に登録。`OPENAI_API_KEY`・`ANTHROPIC_API_KEY` は Secret、その他 3 件は Config。Preview・Development への同じ変数の登録は見つかっていない（Shared 設定は未確認） |
| Vercel Firewall のレート制限 | ✅ 1 件のルール内で `/api/chat` と `/login` を OR 条件で指定。IP ごとに 60 秒 20 回（2 つのパスで合算）、超過時は Deny（403）。設定後もログイン・AI 検索が正常に動くことを確認済み。**超過時の動作は未検証** |
| Vercel Deployment Protection | ✅ Vercel Authentication ON（Standard Protection）で Preview を保護、Protected Sourcemaps ON |
| Supabase Auth | ✅ 新規登録（Allow new users to sign up）OFF、匿名ログイン OFF、メール確認 ON、パスワードは 16 文字以上で英大文字・英小文字・数字・記号が必須（管理画面で確認） |
| 管理者パスワード | ✅ 管理 API で変更し、新しいパスワードでログイン・ログアウト・再ログインを確認 |
| セキュリティヘッダー（HSTS・`X-Frame-Options`・`X-Robots-Tag: noindex`） | ✅ 本番 URL の応答で確認 |
| Supabase の URL 設定（Site URL・Redirect URLs） | 未確認（確認の記録なし） |

詳細と残る懸念点は [docs/SECURITY.md](docs/SECURITY.md)・[docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md)。
