# GitHub 公開準備

最終確認: 2026-11-24（https://github.com/iototoooo/rag-document-search へ push 済み。Vercel の Production にデプロイ済み）

## 1. 公開用リポジトリの作り方

開発用リポジトリ（Git 履歴あり・学習用サンプルを使うテストを含む）とは別に、**公開用リポジトリを履歴なしで新しく作成**しました。

| 項目 | 内容 |
| --- | --- |
| 元にしたもの | 開発用リポジトリの最新コミットのファイル（`git archive`）。**過去の Git 履歴はコピーしていない** |
| 除いたもの | 学習用サンプル（文書名・テスト質問・期待回答・本文の抜粋）に依存するテストと記述 |
| 置き換えたもの | テストの文書・質問を、架空の「サンプル株式会社」の規程（`tests/fixtures/demo-corpus.ts`）に変更。テストの目的（取り込み・検索・権限・出典・採点）は維持 |
| 精度の記録 | 正答率 100% は**学習用サンプル 5 文書・テスト質問 12 問での実測**として、集計値のみ記載（[EVALUATION.md](./EVALUATION.md)）。応答時間 5 秒以内は**未達**と明記 |

## 2. 推奨リポジトリ名

| 候補 | 理由 |
| --- | --- |
| **`rag-document-search`**（推奨） | `package.json` の `name` と一致し、手順書の記載とずれない |
| `internal-docs-rag-ja` | 「日本語の社内文書 RAG」であることが名前から分かる |

説明文（Description）の例: `社内文書（PDF）を根拠に出典付きで回答する RAG の学習用 MVP（Next.js 16 / Supabase pgvector / Claude）`

## 3. 公開前の確認結果

| # | 確認内容 | 結果 |
| --- | --- | --- |
| 1 | API キー・パスワード・service_role キー（`.env.local` の実際の値と、キー形式の文字列） | ✅ なし（`npm run scan:secrets`） |
| 2 | Supabase の接続情報（URL・プロジェクト ID・anon キー）、メールドメインの設定値 | ✅ なし |
| 3 | 個人のメールアドレス・Windows のユーザー名・PC のフォルダパス | ✅ なし |
| 4 | PDF・CSV・Markdown 原本、`samples/`、`reports/`、`.env*`（`.env.example` を除く） | ✅ なし |
| 5 | 学習用サンプルの文書名・質問・期待回答・本文の転載 | ✅ なし（サンプルとの 8 文字以上の一致を機械的に照合。残る一致は「該当する情報が見つかりません」などアプリの仕様文言・一般的な語句のみ） |
| 6 | コミットの作者・コミッター | ✅ GitHub の noreply アドレス |

## 4. 公開しないファイル（`.gitignore` で除外）

| パス | 理由 |
| --- | --- |
| `.env.local`、`.env*`（`.env.example` 以外） | API キー・service_role キー・検証用パスワード |
| `samples/`、`*.pdf`、`*.csv`、`*.xlsx`、`*.docx` | 文書の原本（公開しない） |
| `reports/` | 評価結果（質問・回答・文書抜粋）、セキュリティテストの記録（文書 ID） |
| `.next/`、`node_modules/`、`*.tsbuildinfo`、`next-env.d.ts` | ビルド成果物・依存関係 |
| `.vercel/`、`.supabase/`、`supabase/.temp/` | 各サービスのローカル連携情報 |

## 5. push の手順（利用者が実施）

1. GitHub の **Settings > Emails** で「Keep my email addresses private」と「Block command line pushes that expose my email」が有効であることを確認する。
2. GitHub で空のリポジトリを作成する（README・.gitignore・License は**追加しない**）。
3. PowerShell で次を実行する。

```powershell
cd <公開用リポジトリのフォルダ>
npm ci; npm run check; npm run build; npm run scan:secrets   # すべて OK を確認
git status --short                                           # 何も表示されないこと
git log --format='%ae %ce' | Sort-Object -Unique             # noreply アドレスのみ
git remote add origin https://github.com/<ユーザー名>/rag-document-search.git
git push -u origin main
```

4. push 後、GitHub の **Settings > Code security** で **Secret scanning** と **Push protection** を有効にする（公開リポジトリは無料）。
5. ライセンスを付けない場合、閲覧はできても再利用は許可されない扱いになります。付ける場合は利用者が判断して追加してください。

ライセンスは付けていません（2026-11-24 時点の方針）。

## 6. 今後の更新方法

開発は開発用リポジトリで行い、公開用には**確認済みの変更だけを反映**します。

1. 開発用で変更をコミットし、テストを通す。
2. 変更したファイルを公開用にコピーする（学習用サンプル由来の値を含むテスト・資料はコピーしないか、架空データ版を維持する）。
3. 公開用で `npm run check`・`npm run build`・`npm run scan:secrets` を実行し、コミットして push する。
