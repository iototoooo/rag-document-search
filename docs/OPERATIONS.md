# 管理者向け運用手順書

日常運用（利用者管理・文書管理・費用監視・障害対応）の手順です。初期構築は [初期設定マニュアル](./SETUP.md) を参照してください。
**⚠ マークの手順は DB 変更・外部 API 呼び出し（課金）を伴います。**

## 1. 利用者の管理

### 追加（⚠ DB 変更）

1. Supabase **Authentication > Users > Add user**
   - **Create new user** + **Auto Confirm User** で作成する。初期パスワードは安全な方法で本人に伝える。
   - 本アプリにはパスワード設定・変更の画面がないため、**Send invitation（招待メール）やパスワード再設定メールは使わない**（リンク先で設定できない）。パスワードを変える必要があるときは、管理者がユーザーを作り直して `app_users` を再登録するか、管理 API（`auth.admin.updateUserById`）で更新する（Phase 2 でパスワード変更画面を検討）。
2. SQL Editor で利用を許可:

```sql
insert into public.app_users (user_id, is_active, role)
select id, true, 'member' from auth.users where email = '<メール>'
on conflict (user_id) do update set is_active = true, updated_at = now();
```

### 利用停止・削除

```sql
-- 一時停止（ログインはできても API・PDF は 403 になる）
update public.app_users set is_active = false, updated_at = now()
where user_id = (select id from auth.users where email = '<メール>');
```

- 完全に削除する場合は **Authentication > Users** で該当ユーザーを Delete（`app_users` も自動削除）。
- 退職・異動時は当日中に停止する。

### 定期確認（月 1 回）

```sql
select u.email, a.is_active, a.role, u.last_sign_in_at
from public.app_users a join auth.users u on u.id = a.user_id
order by u.last_sign_in_at nulls first;
```

長期間ログインのない利用者は停止を検討する。

## 2. 文書の追加・更新・再 Embedding

取り込みは管理者 PC から CLI で行います（Web 画面はありません）。技術的な詳細は [INGEST.md](./INGEST.md)。

### 共通の注意

- 取り込めるのは **公開許可済み（全社員が見てよい）文書のみ**。CLI は `visibility = internal` で登録します。部署限定文書は Phase 2 まで取り込まない。
- ファイル名（拡張子なし）が文書の識別子（`source_key`）です。英数字・`-`・`_`・`.` のみ使用可。**同じ名前 = 同じ文書** として扱われます。
- 文書本文は OpenAI に送信されます（Embedding のため）。

### 追加（⚠）

```powershell
# 1. PDF を取り込み用フォルダに置く（例: samples/pdf または任意のフォルダ）
# 2. ドライランで件数・チャンク数を確認（外部通信なし）
npm run ingest -- --dir <フォルダ>
# 3. 実行（新しい文書だけが取り込まれ、既存の同一内容はスキップ）
npm run ingest -- --dir <フォルダ> --execute
```

### 更新（⚠）

1. **同じファイル名**で新しい版の PDF を置き、上と同じコマンドを実行する。
2. 内容（SHA-256）が変わった文書だけが、同じ文書 ID のままチャンクごと置き換わる（重複しない）。
3. 古い版の PDF が Storage に残るため、**Storage > documents > `<source_key>/`** で、`documents.storage_path` と一致しない古いファイルを削除する。

```sql
-- 現在使われている原本のパス
select source_key, storage_path, updated_at from public.documents order by source_key;
```

### 再 Embedding（全件の作り直し）（⚠ 費用: 文書量に比例）

- 必要になる場面: Embedding モデルの変更、チャンク分割ロジックの変更。
- 同一内容の文書はスキップされるため、作り直す場合は対象の文書を一度削除してから取り込む（下記「削除」→「追加」）。
- **Embedding の次元数を変える場合は DB 列（`vector(1536)`）の変更が必要**。マイグレーションの追加と全件再取り込みになるため、計画して実施する。

### 削除（⚠）

```sql
-- チャンクも自動削除（on delete cascade）
delete from public.documents where source_key = '<source_key>';
```

続けて **Storage > documents > `<source_key>/`** のファイルを削除する。

### 取り込み後の確認

```sql
select d.source_key, d.visibility, d.page_count, count(c.id) as chunks, d.updated_at
from public.documents d left join public.document_chunks c on c.document_id = d.id
group by d.id order by d.source_key;
```

その後、代表的な質問で回答と出典を確認し、必要に応じて精度検証（[EVALUATION.md](./EVALUATION.md)）を実行する。

## 3. 費用の監視

| 対象 | 確認場所 | 頻度 |
| --- | --- | --- |
| Claude API | Anthropic Console > Usage / Cost、利用上限の設定 | 週 1 回 |
| OpenAI | OpenAI Platform > Usage、利用上限の設定 | 月 1 回 |
| Supabase | Dashboard > Usage（DB サイズ・Storage・転送量） | 月 1 回 |
| Vercel | Dashboard > Usage（関数実行時間） | 月 1 回 |

- 想定外に増えた場合: `.env` の `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` / `RAG_MATCH_COUNT` を見直す。必要なら API キーを一時無効化して停止する。
- モデルの変更は許可リスト（opus / sonnet / haiku 5.5）の範囲で行い、変更後は精度検証を再実施する。

## 4. API キー・秘密情報の管理

| 事象 | 対応 |
| --- | --- |
| 漏えいの疑い（誤コミット・誤送信など） | **ただちに**該当キーを各管理画面で無効化 → 新しいキーを発行 → `.env.local` / Vercel を更新 → 再デプロイ |
| service_role キーの漏えい | 上記に加え、Supabase の **API Keys** でキーをローテーション。DB の不審な変更を確認 |
| 定期ローテーション | 年 1 回、または担当者の交代時 |

- キーをチャット・メール・チケット・スクリーンショットに貼らない。

## 5. 障害対応

1. 利用者からの連絡（発生時刻・操作内容）を記録する。
2. [トラブルシューティング](./TROUBLESHOOTING.md) で症状を確認する。
3. Vercel の **Logs** を確認する（ログにはエラーの種類のみが出力され、質問文・本文は出ない設計）。
4. 外部サービスの障害は各社のステータスページ（Supabase / OpenAI / Anthropic / Vercel）で確認する。
5. 対応内容を記録し、再発防止策を検討する。

## 6. 定期作業チェックリスト

| 頻度 | 作業 |
| --- | --- |
| 週次 | 費用の確認、エラーログの確認 |
| 月次 | 利用者一覧の棚卸し、Storage の古い原本の削除、依存パッケージの脆弱性確認（`npm audit`） |
| 文書更新時 | 取り込み → 取り込み後の確認 → 代表質問で確認 |
| モデル・設定変更時 | 精度検証（12 問）を再実施し、[EVALUATION.md](./EVALUATION.md) に記録 |
