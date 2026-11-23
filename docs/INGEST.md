# 文書取り込み（feature/ingest）

PDF をページ単位でテキスト抽出し、正規化・チャンク分割・Embedding を行って Supabase（pgvector）へ保存します。

## 使い方（PowerShell）

```powershell
cd <リポジトリのフォルダ>   # 例: C:\dev\rag-document-search

# ドライラン（既定）: モック Embedding + インメモリ保存。外部通信なし・課金なし
npm run ingest
npm run ingest -- --dir samples\pdf

# 実行: OpenAI Embeddings API（有料）を呼び出し、Supabase に保存する
#   事前に .env.local と DB マイグレーションの適用が必要
npm run ingest -- --execute
```

出力は統計のみです（本文・抽出テキストは表示しません）。

```
file | status | pages | chunks | tokens(min/avg/max)
demo-doc1-travel-rules.pdf | ingested | 2 | 3 | 74/216/339
...
total: 5 files, 14 chunks, 0 errors
```

| モード | Embedding | 保存先 | 外部通信 |
| --- | --- | --- | --- |
| ドライラン（既定） | `MockEmbeddingProvider`（決定的・1536 次元） | インメモリ | なし |
| `--execute` | OpenAI `EMBEDDING_MODEL`（既定 `text-embedding-3-small`） | Supabase `documents` / `document_chunks` / 非公開バケット `documents` | あり（OpenAI・Supabase） |

`--execute` に必要な環境変数: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`（`EMBEDDING_DIMENSIONS` は 1536 固定）。
不足している場合はキー名だけを表示して終了し、外部通信は行いません。

- CLI は `tsx --conditions=react-server` で実行します（`server-only` を含む共通モジュールを CLI から読み込むため）。
- service_role キーを使うのはこの CLI だけです。Web アプリのリクエスト処理では使いません。
- MVP では取り込む文書の公開範囲を `internal`（認可済み全社員）に固定しています。部署限定文書は扱いません。

## 処理の流れ（`src/lib/ingest/pipeline.ts`）

1. ファイル名から `sourceKey` を決定（拡張子を除いたもの。英数字・`.`・`-`・`_` のみ許可）
2. 元バイト列の SHA-256 を計算
3. 既存文書と **内容ハッシュ・Embedding モデル・公開範囲・部署** がすべて同じならスキップ
4. unpdf でページごとにテキスト抽出 → `normalizeText`（NFKC）＋部首補助文字の置換（`⻑`→`長`、`⺠`→`民` など）
5. チャンク分割 → Embedding（入力は「文書タイトル + 改行 + チャンク本文」。保存する本文にはタイトルを含めない）
6. 非公開バケットへ原本をアップロード（パス: `{sourceKey}/{sha256}.pdf`、upsert）
7. RPC `replace_document_with_chunks` で文書メタデータの upsert と、チャンクの削除・挿入を **1 トランザクション** で実行

## 再取り込みの挙動

| 状況 | 結果 |
| --- | --- |
| 同じファイルをもう一度取り込む | `skipped`（Embedding API を呼ばない・DB を更新しない） |
| 内容を更新した | 同じ文書 ID のまま、チャンクをすべて置き換え（古いチャンクは残らない） |
| 公開範囲・Embedding モデルを変えた | 再取り込み（チャンク置き換え） |
| 途中で失敗した | DB はトランザクションのため変更なし。原本は決定的なパスなので再実行で上書き |

`document_chunks.chunk_key`（`{sourceKey}:p{page}:c{index}`）と `(document_id, chunk_index)` は DB で一意制約があり、重複登録できません。

## チャンク設計（`src/lib/ingest/chunker.ts`）

| 項目 | 既定値 | 説明 |
| --- | --- | --- |
| `maxTokens` | 800 | 1 チャンクの上限（目安 500〜1000） |
| `minTokens` | 300 | 小さいセクションは、同じページ内でこの値に達するまで結合 |
| `overlapTokens` | 100 | 長いセクションを分割する場合のみ、前のチャンクの末尾行を重複させる |

- **ページをまたがない**: 出典ページの正確さを優先し、`pageEnd = pageNumber`。前のページから続くセクションは、見出しを先頭に付けたチャンクになる。
- **見出し検出**（`sections.ts`）: `第N章 …`、`N. 見出し`、`N.N 見出し`、Markdown の `#`。40 文字を超える行や句点で終わる行（番号付き手順など）は見出しにしない。
- **折り返し行の連結**: PDF で自動折り返しされた行は、文末記号で終わらずページ内の最長行に近い幅の場合だけ次の行と連結する（表や箇条書きは連結しない）。
- **トークン数の概算**（`tokens.ts`）: CJK は 1 文字 ≒ 1 トークン、ASCII は 4 文字ごとに ≒ 1.3 トークン。外部トークナイザは使わない保守的な見積もり。
- サンプル文書は 1 文書あたり 500〜800 文字程度と小さいため、チャンクは 50〜400 トークン程度になる（文書あたり 2〜3 チャンク）。

## DB（`supabase/migrations/20261122000100_ingest_rpc.sql`）

- `replace_document_with_chunks(p_document jsonb, p_chunks jsonb) returns uuid`
- `security invoker`, `set search_path = ''`
- 実行権限は `service_role` のみ（`public` / `anon` / `authenticated` からは revoke）
- `visibility` 未指定はエラー（既定値に頼らない）

## 未対応・今後の課題

- 文書の内容を更新すると、古い原本（前回の `{sha256}.pdf`）が Storage に残る（削除処理は未実装）。
- `samples/pdf` 直下の PDF のみが対象。Markdown の取り込みは pipeline では対応済みだが、CLI からは未使用。
- 画像のみの PDF（OCR が必要なもの）は「テキストを抽出できませんでした」として失敗する。
