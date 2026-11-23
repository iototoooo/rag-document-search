# トラブルシューティング

症状から原因と対応を探してください。解決しない場合は、**エラー文（API キー等を除く）・発生時刻・操作内容**を控えて相談してください。

## ログイン・権限

| 症状 | 主な原因 | 対応 |
| --- | --- | --- |
| 「ログインできませんでした」 | メール・パスワードの誤り / メール未確認 / `app_users` 未登録・無効 / `ALLOWED_EMAIL_DOMAINS` 不一致 | Auth > Users でメール確認状態、`app_users` の `is_active`、`.env` のドメイン設定を確認 |
| 「利用権限がありません」 | ログインは成功したが `app_users.is_active` が false / 未登録 | [運用手順書](./OPERATIONS.md) の「追加」SQL を実行 |
| ログイン後すぐ `/login` に戻る | Cookie が保存されない / Site URL・リダイレクト URL の設定違い | Supabase の URL Configuration、ブラウザの Cookie 設定、`NEXT_PUBLIC_SUPABASE_URL` を確認 |
| 「現在ログインできません」 | Supabase に接続できない / 環境変数未設定 | `.env.local`（Vercel の環境変数）と Supabase のステータスを確認 |

## 質問・回答

| 症状 | 主な原因 | 対応 |
| --- | --- | --- |
| どの質問も「該当する情報が見つかりません」 | 文書が未取り込み / `visibility` が internal でない / しきい値が高すぎる | `select visibility, count(*) from documents group by 1;` を確認。`RAG_MATCH_THRESHOLD` を下げて再確認（例 0.2） |
| 記載のある質問なのに見つからない | 検索で上位に入らない / チャンク分割で要点が分断 | `npm run eval -- --live --execute --only <番号>` で検索ヒットを確認。`RAG_MATCH_COUNT` を増やす、質問の言い回しを変える |
| 回答に出典が付かない | LLM が出典番号を返さなかった（その場合は「該当なし」扱い） | 精度検証で頻度を確認し、プロンプト・effort を見直す |
| 「外部サービスに接続できませんでした」（503） | OpenAI / Anthropic の障害・レート制限・タイムアウト | 各社ステータスを確認。続く場合は `ANTHROPIC_TIMEOUT_MS` を確認 |
| 「エラーが発生しました」（500） | 設定エラー（キー未設定・モデル名が許可リスト外 など）/ 応答形式の異常 | Vercel Logs のエラー種別を確認。`.env` の値を `.env.example` と照合 |
| 「しばらく時間をおいて…」（429） | 1 分 20 回のレート制限 | 1 分待つ。正当な利用で頻発する場合は上限の見直しを検討 |
| 応答が遅い（5 秒超） | effort が高い / 資料数が多い / リージョンが遠い | `ANTHROPIC_EFFORT=low`、`RAG_MATCH_COUNT` を減らす、Vercel 関数を Tokyo に。必要ならモデル変更を検討 |

## 出典 PDF

| 症状 | 主な原因 | 対応 |
| --- | --- | --- |
| 出典をクリックすると「見つかりません」（404） | 原本が Storage にない / `storage_path` 不一致 / 閲覧権限がない | `documents.storage_path` と Storage のファイルを照合。必要なら再取り込み |
| PDF は開くが該当ページに移動しない | ブラウザのビューアが `#page=N` に未対応 | Chrome / Edge で確認。ページ番号は出典に表示されているので手動で移動 |
| ログアウト後も PDF が表示される | ブラウザのタブに表示済みの内容 | 再読み込みすると 401 になることを確認（キャッシュ不可の設定済み） |

## 取り込み（`npm run ingest`）

| 症状 | 主な原因 | 対応 |
| --- | --- | --- |
| 「環境変数が不正または未設定です: …」 | 表示されたキー名が `.env.local` にない・形式違い | キー名の値を設定（値は表示されない設計） |
| 「テキストを抽出できませんでした」 | 画像だけの PDF（スキャン） | OCR は未対応（Phase 2 で検討）。テキスト付き PDF を用意 |
| `permission denied for function replace_document_with_chunks` | service_role ではないキーを使っている | `SUPABASE_SERVICE_ROLE_KEY` に service_role / Secret key を設定 |
| すべて `skipped` になる | 内容が前回と同じ（正常動作） | 作り直す場合は [運用手順書](./OPERATIONS.md) の「再 Embedding」 |
| `different vector dimensions` 等 | Embedding の次元が 1536 でない | `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` を既定値に戻す |

## 開発環境（Windows）

| 症状 | 対応 |
| --- | --- |
| `npm run typecheck` で `LayoutProps` が見つからない | `next typegen` を含む `npm run typecheck` を使う（`tsc` 単体では型が生成されない） |
| `npm ci` で `@types/node` の peer 依存エラー | `package-lock.json` どおりに `npm ci` を使う（`--force` は使わない） |
| PDF の漢字が検索で一致しない（「⽇」など） | 取り込み時に NFKC・部首補助を正規化済み。古いデータなら再取り込み |
| PowerShell で `&&` が使えない | Windows PowerShell 5.1 では `;` で区切る、または PowerShell 7 / Git Bash を使う |
