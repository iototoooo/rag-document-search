# 社内文書検索AI（RAG）— 学習用MVP

社内文書（PDF）を取り込み、質問に対して関連箇所を検索し、**社内文書だけを根拠に出典（ファイル名・ページ）付きで回答**する学習用の RAG アプリです。
文書に書かれていない質問には「該当する情報が見つかりません」と答えます。

**学習用のダミー資料のみを使用します。実在の社内文書は取り込まないでください。**

## 現在の状態（2026-11-24）

| 区分 | 内容 |
| --- | --- |
| ✅ 完了（実環境で確認） | Supabase 東京への SQL 適用・文書 5 件の取り込み、**正答率 100%（12/12）**・記載なし 2 問で「該当なし」2/2（実 API・1 回。**学習用の配布資料 5 文書・12 問での実測**で、他の文書や本リポジトリの架空データで同じ結果を保証するものではありません）、実 DB での権限確認（未認証・未登録ユーザーの拒否、部署限定・restricted 文書の非表示: [T-1〜T-3](docs/SECURITY_TEST_T1-T3.md) 31/31 合格）、画面でのログイン・回答・出典 PDF 表示 |
| ⚠ **未達** | 応答時間 p95 5 秒以内（実測 p95 7.7 秒。12 問中 1 問だけ遅く、原因は未特定・再測定待ち。[EVALUATION.md](docs/EVALUATION.md)） |
| ⬜ 未実施 | GitHub への push、Vercel へのデプロイと公開後の確認（[公開前チェックリスト](docs/DEPLOY_CHECKLIST.md)）、スマートフォン実機での確認、教材の PDF 200 件規模での取り込み |

詳細は [docs/DELIVERY_CHECKLIST.md](docs/DELIVERY_CHECKLIST.md)。

## 資料

| 資料 | 内容 |
| --- | --- |
| [docs/README.md](docs/README.md) | 納品資料の一覧（ここから辿れます） |
| [docs/SETUP.md](docs/SETUP.md) | 初期設定マニュアル（Supabase・API・Vercel） |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | 利用者向け操作マニュアル |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 管理者向け運用手順（PDF 追加・更新・再 Embedding を含む） |
| [docs/SECURITY.md](docs/SECURITY.md) | セキュリティ設計書（確認結果・残る懸念点） |
| [docs/DEPLOY_CHECKLIST.md](docs/DEPLOY_CHECKLIST.md) | Vercel 公開前チェックリスト（環境変数・Preview の保護・Firewall・公開後の確認） |

## 技術構成

| 役割 | 採用技術 |
| --- | --- |
| フロントエンド / API | Next.js 16（App Router）+ TypeScript + Tailwind CSS |
| DB・ベクトル検索・認証・ファイル | Supabase（PostgreSQL + pgvector + Auth + Storage）、東京リージョン |
| ホスティング | Vercel（関数リージョン: 東京 `hnd1`。`vercel.json` で指定） |
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

- このリポジトリには **PDF・質問 CSV などの文書データを含めていません**（`samples/` は `.gitignore` で除外）。開発時は学習用の配布資料（ダミーの社内文書 5 件・テスト質問 12 問）を使いましたが、再配布しません。
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

詳細と残る懸念点は [docs/SECURITY.md](docs/SECURITY.md)。
