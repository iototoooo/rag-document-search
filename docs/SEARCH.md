# 検索・回答生成（feature/search）

## 処理フロー（`POST /api/chat`）

1. **認証・認可**（`authorizeUser`）— 最初に実行。401 / 403 の場合は Embedding・検索・LLM を一切呼ばない。
2. **レート制限** — ユーザー単位で 1 分 20 回（インメモリ、単一プロセス前提）。超過は 429。
3. **入力検証** — `Content-Type: application/json`、本文 16KB 以下（超過 413）、`chatRequestSchema`（1〜1000 文字、違反 400）。
4. **質問の Embedding** — `OpenAIEmbeddingProvider`（`text-embedding-3-small`, 1536 次元）。
5. **ベクトル検索** — `SupabaseChunkSearcher` が `match_document_chunks` RPC を **ユーザー権限のクライアント** で呼ぶ（RLS 適用）。
6. **根拠なし判定** — しきい値を超えるチャンクが 0 件なら LLM を呼ばず `該当する情報が見つかりません` を返す。
7. **回答生成** — `ClaudeAnswerGenerator`（`client.beta.messages.parse` + 構造化出力 `{found, answer, cited_source_ids}`）。
8. **出典の検証** — `buildCitations` が LLM の出典番号をサーバー側一覧と照合し、Citation を生成。
9. **レスポンス検証** — `chatResponseSchema` で検証してから返す。`Cache-Control: no-store`。

## 設定

| 環境変数 | 既定値 | 説明 |
| --- | --- | --- |
| `RAG_MATCH_THRESHOLD` | `0.3` | コサイン類似度のしきい値（0〜1）。これ未満は根拠に使わない |
| `RAG_MATCH_COUNT` | `6` | 取得チャンク数（1〜20）。SQL 関数側でも最大 20 に制限 |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | 回答生成モデル。許可リスト（`claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5`）以外は起動時エラー |
| `ANTHROPIC_EFFORT` | `low` | `low` / `medium` / `high`。`xhigh` / `max` は費用・遅延が大きいため不可 |
| `ANTHROPIC_MAX_TOKENS` | `8000` | 1 回答の出力上限（思考トークン含む。1024〜16000） |
| `ANTHROPIC_MAX_RETRIES` | `1` | 自動再試行回数（0〜2） |
| `ANTHROPIC_TIMEOUT_MS` | `30000` | 1 リクエストのタイムアウト |
| `ANTHROPIC_SERVER_FALLBACK` | `false` | `true` のときだけ拒否時のサーバー側フォールバック（別モデルで再実行）を有効化 |
| `OPENAI_MAX_RETRIES` | `1` | Embedding API の自動再試行回数（0〜2） |

しきい値は実データ（12 問のテスト質問）で再調整が必要です。モック Embedding の類似度は実モデルと分布が異なります。

## Claude 呼び出し

- サーバー側フォールバック（拒否時に別モデルで自動再実行）は、課金先モデルが変わるため**既定で無効**。`ANTHROPIC_SERVER_FALLBACK=true` のときだけ `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` を送る。
- `thinking` は送らない（Opus 5.5 は常時 adaptive）。深さは `output_config.effort` で制御。
- `stop_reason === "refusal"` を最初に確認 → 利用者には `found=false` の定型文。
- `parsed_output === null` / `max_tokens` は 500。接続失敗・429・5xx は 503。
- 根拠資料は `<source id=… file=… page=…>` でデータとして渡し、資料内の偽タグは無害化。資料内の指示に従わないようシステムプロンプトで指示。

## 出典の検証（存在しない出典を作らせない）

- LLM に渡すのは連番 `[1]`〜`[n]` と、ファイル名・ページ・本文のみ。`documentId` / `chunkId` は渡さない。
- 返された `cited_source_ids` と本文中の `[n]` を、今回渡した一覧と照合。存在しない番号は出典から除外し、本文からもマーカーを削除。
- 有効な出典が 0 件なら回答を破棄し `found=false`。
- Citation のファイル名・ページ・文書 ID はすべてサーバー側の検索結果から生成。

## 権限設計

- 検索は `createUserSupabaseClient()`（anon キー + ユーザー JWT）でのみ実行。service_role は使わない。
- `match_document_chunks` は `security invoker` のため RLS が適用され、閲覧不可の文書は結果・件数に現れない。
- テスト（`answer-service.test.ts` / `handler.test.ts`）では RLS を模した検索で、部署限定文書の本文・ファイル名・ID・件数が
  レスポンスにも LLM 入力にも出ないことを確認。

## ログ

- `logError` でエラー種別（name / status / code）のみ記録。質問文・資料・回答・キーは記録しない（テストで確認）。

## 実環境での確認状況（2026-11-24）

- ✅ 実 Supabase での RPC 呼び出し（pgvector の文字列形式での受け渡し・RLS 適用）: `npm run verify:db`、T-2・T-3（[記録](./SECURITY_TEST_T1-T3.md)）。
  検索 RPC は類似度が 0 未満のチャンクを返さない（`similarity >= greatest(threshold, 0)`）。
- ✅ 実 OpenAI Embedding・実 Claude API での回答品質: 12 問で正答率 100%（[EVALUATION.md](./EVALUATION.md)）。
- ⏳ 文書数が増えたときのしきい値の妥当性・HNSW の検索精度（現在は 5 文書・14 チャンク）。
- ⏳ 応答時間（p95 7.7 秒で目標 5 秒を未達。段階別の計測を追加済み）。
- ⏳ 複数インスタンス構成でのレート制限（現状はプロセス内のみ。Vercel Firewall で補う: [公開前チェックリスト](./DEPLOY_CHECKLIST.md) 4 章）。
