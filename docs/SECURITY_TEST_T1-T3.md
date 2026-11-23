# セキュリティテスト T-1〜T-3（実環境）手順と記録

| # | 検証内容 |
| --- | --- |
| T-1 | `app_users` に登録されていないユーザーは、ログインできても何も見えず、API は 403 |
| T-2 | 部署限定（`department`）文書が、登録済みの一般利用者に一切見えない |
| T-3 | `restricted` 文書が、登録済みの一般利用者に一切見えない |

> **状態: 実施済み（2026-11-24 JST）— T-1・T-2・T-3 すべて合格（31 / 31 OK）**。テストデータは削除済みで、文書 5・チャンク 14 に戻したことを確認した。
> 未登録の Auth ユーザー（T-1 用）は、利用者が後日 Dashboard から削除する（本書 4-4 の手順 11）。

## 1. 方針

- **AI API を使わない（費用 $0）**: ダミー文書の Embedding は OpenAI ではなく決定的な合成ベクトルを使う。登録ユーザーの `/api/chat` は呼ばない（未登録ユーザーの `/api/chat` は認可で止まり AI API に届かない）。
- **漏えいを確実に検出する**: 検索はダミー文書と**同じベクトル**で行う。RLS が漏れていれば類似度 ≒1.0 で必ず 1 位に出る。さらに本文に固有の合言葉（`SECTEST-CANARY-…`）を入れ、検索結果・出典の本文に現れないことも確認する。
- **最小限の追加**: Auth ユーザー 1 人（T-1）、文書 2 件・チャンク 2 件・Storage 2 件（T-2・T-3）。
- **区別できる**: テストデータはすべて `zz-sectest-` で始まる。タイトルは「【セキュリティ検証用ダミー】…」。
- **既存データに触れない**: 既存 5 文書・14 チャンク・既存テストユーザーの `app_users` 行は変更しない。作成前に件数が 5 / 14 でなければ中止する。
- **削除は記録した ID だけ**: 作成時に `reports/sectest/manifest.json`（Git 管理外）へ ID を記録し、削除時に「記録した ID・`zz-sectest-` 接頭辞・internal でない」の 3 条件を DB と照合してから 1 件ずつ削除する。

## 2. 追加するデータと費用

| 種類 | 内容 | 作成方法 | 削除方法 |
| --- | --- | --- | --- |
| Auth ユーザー | T-1 用の未登録ユーザー 1 人（例: `sectest-unregistered@<テスト用ドメイン>`。**`app_users` には登録しない**） | 利用者が Dashboard で作成 | 利用者が Dashboard で削除 |
| documents | `zz-sectest-department`（visibility=department、department=`sectest-dummy-dept`）、`zz-sectest-restricted`（visibility=restricted） | `npm run sectest -- setup --execute`（service_role・取り込み RPC） | `npm run sectest -- cleanup --execute` |
| document_chunks | 各文書に 1 件（合成 Embedding・合言葉入りの短い本文） | 同上 | 文書の削除で連鎖削除 |
| Storage | 各文書の最小 PDF 1 件（`zz-sectest-…/<hash>.pdf`、英数字 1 行） | 同上 | 同上（記録したパスだけ） |

| 費用 | 金額 |
| --- | --- |
| OpenAI / Anthropic | **$0**（呼び出しなし） |
| Supabase | 無料プランの範囲（数 KB） |

## 3. リスクと対策

| リスク | 対策 |
| --- | --- |
| 既存文書の上書き | 取り込み RPC は `source_key` で上書きするが、テスト用は `zz-sectest-` で始まり既存と重複しない。作成前に既存件数 5 / 14・テスト用 0 件を確認し、違えば中止 |
| テストデータが残る | 作成の各段階でマニフェストに記録するため、途中で失敗しても cleanup で消せる |
| 既存データの誤削除 | 削除はマニフェストの ID のみ。DB 側の `source_key` が `zz-sectest-` で始まり、かつ internal でないことを照合し、`delete` にも同じ条件を付ける。照合で 1 件でも問題があれば何も削除しない |
| 検証中に利用者の画面にダミーが出る | RLS により出ない設計（それ自体が検証対象）。出た場合は T-2・T-3 が NG で、直ちに cleanup |
| 未登録ユーザーの消し忘れ | 最後に `03_sectest_state.sql` で Auth ユーザー 1・未登録 0 を確認 |
| ログイン記録 | 検証でのログインは画面ログインと同じ記録が残る。終了時はその端末のセッションのみログアウト |

## 4. 手順

### 4-1. 事前確認（読み取りのみ）

1. `npm run sectest` → 「想定どおり」「テスト用 0 件」「マニフェスト: なし」を確認。
2. SQL Editor で `supabase/verify/03_sectest_state.sql` → 下表の「作成前」に記入。

### 4-2. テストデータの作成（⚠ DB 変更・要承認）

3. **T-1 ユーザー**: Dashboard > Authentication > Users > Add user > Create new user（Auto Confirm にチェック）。`app_users` への登録 SQL は**実行しない**。
4. `.env.local` に `VERIFY_UNREGISTERED_EMAIL` / `VERIFY_UNREGISTERED_PASSWORD` を入力（`VERIFY_USER_*` は既存テストユーザー）。
5. `npm run sectest -- setup` で前提条件を確認（ドライラン）→ `npm run sectest -- setup --execute`。
   「作成後: 文書 7 / チャンク 16 … OK」を確認。
6. `03_sectest_state.sql` → 「作成後」に記入（テスト用文書の ID も控える）。

### 4-3. 検証（読み取り + ログイン）

7. `npm run dev` を起動した状態で `npm run sectest -- verify --app-url http://localhost:3000`。
   結果は `reports/sectest/<日時>-verify.md` にも保存される。
8. （任意・画面確認）未登録ユーザーでブラウザからログイン →「利用権限がありません」。
   登録ユーザーでログイン後、`http://localhost:3000/api/documents/<テスト用文書ID>/file` を開く → 404 の JSON。

### 4-4. 後片付け（⚠ DB 変更・要承認）

9. `npm run sectest -- cleanup`（ドライラン）で削除対象 2 件・Storage 2 件が**テスト用だけ**であることを確認。
10. `npm run sectest -- cleanup --execute` →「元の状態に戻りました」を確認。
11. Dashboard で T-1 ユーザーを削除。`.env.local` の `VERIFY_*` を空に戻す。
12. `03_sectest_state.sql` → 「削除後」に記入し、作成前と一致することを確認。
13. `npm run verify:db`（25 項目）で既存環境が変わっていないことを確認。

## 5. 自動検証の項目（`sectest verify`）

| 対象 | 確認内容 | 期待 |
| --- | --- | --- |
| 前提 | テスト用文書 2 件（department 1・restricted 1）が存在 | OK |
| 登録ユーザー | `app_users` は自分の 1 行のみ | 1 行 |
| 〃 | 見える文書 5 件・すべて internal／件数（count）も 5 | テスト文書を含まない |
| 〃 | 見えるチャンク 14 件 | 16 ではない |
| 〃 | テスト文書・チャンクを **ID 指定**でも取得できない | 0 件 |
| 〃 | **テスト文書と同じベクトル**で検索 → テスト文書・合言葉・`zz-sectest-` ファイル名が結果に出ない（= 出典にも出ない）／結果はすべて閲覧可能な文書／件数は「internal チャンクのうち類似度 0 以上の数」と一致 | 漏えい 0 |
| 〃 | Storage からテスト PDF を直接取得できない／internal PDF は取得できる（対照） | 拒否／取得 |
| 〃 | アプリ: テスト文書の PDF API は 404、internal の PDF API は 200（対照） | 404／200 |
| 未登録ユーザー | `app_users` に自分の行がない | 0 行 |
| 〃 | 見える文書・チャンク・件数がすべて 0、ID 指定でも 0 | 0 |
| 〃 | 検索結果 0 件（テスト文書も internal も） | 0 件 |
| 〃 | Storage の PDF（テスト・internal とも）を取得できない | 拒否 |
| 〃 | アプリ: PDF API（テスト・internal とも）は 403、`/api/chat` は 403、画面は「利用権限がありません」 | 403 |

出典は検索結果のチャンクからサーバー側でのみ作られる（`buildCitations`）ため、検索結果に現れないことが「出典に出ない」ことの根拠になる。

## 6. 結果記録（実施後に記入）

### 件数の照合（`npm run sectest` の service_role 読み取り + 管理 API）

接続先は開発用プロジェクト（東京）。`app_users` の件数は service_role に権限がないため、CLI では取得していない（SQL Editor の `03_sectest_state.sql` で利用者が確認する）。

| 項目 | 作成前 | 作成後 | 削除後 |
| --- | --- | --- | --- |
| documents | 5 | 7 | **5** |
| document_chunks | 14 | 16 | **14** |
| app_users | 1（利用者の報告） | 変更なし（スクリプトは app_users に書き込まない） | 未確認（SQL Editor で確認） |
| Auth ユーザー（管理 API） | 2（既存 1 + T-1 用 1） | 2 | 2（T-1 用は利用者が後で削除） |
| テスト用 文書 / チャンク / Storage | 0 / 0 / 0 | 2 / 2 / 2 | **0 / 0 / 0**（Storage フォルダも 0） |
| テスト用文書の ID | — | 2 件（department 1・restricted 1。ID は Git 管理外の記録に保存） | （なし） |

削除前のドライランで、削除対象がマニフェストの 2 文書（上記 ID）とその Storage 2 件だけであることを照合してから削除した。削除後に `npm run verify:db` を再実行し、**25 / 25 OK**（文書 5・チャンク 14・登録ユーザーの検索と PDF 取得が正常）を確認した。

### 検証結果（`sectest verify`）

| 実施 | 結果（OK / NG / SKIP） | NG の内容 | 対応 |
| --- | --- | --- | --- |
| 1 回目 | 29 / 2 / 0 | 登録ユーザーの検索結果の**件数**が 14 ではなく 13・9 件（漏えいは 0 件、1 位の類似度 0.047・0.037） | **テスト側の期待値の誤り**。検索 RPC は「類似度 >= max(しきい値, 0)」の行だけを返すため、合成ベクトルと類似度が負の internal チャンクは結果に含まれない。service_role で internal 14 チャンクとの類似度を計算し、0 以上がちょうど 13・9 件であることを確認。期待値を「internal チャンクのうち類似度 0 以上の数」に修正し、結果がすべて閲覧可能な文書であることの確認を追加 |
| 2 回目 | **31 / 0 / 0** | なし | — |

2 回目の主な結果:

- 登録ユーザー: 見える文書 5 件（すべて internal・count も 5）、チャンク 14 件、テスト文書・チャンクは ID 指定でも 0 件、同じベクトルでの検索で漏えい 0・閲覧範囲外 0（department 13 件・restricted 9 件 = 期待どおり）、テスト PDF は Storage から取得不可、アプリの PDF API はテスト文書 404・internal 200
- 未登録ユーザー: `app_users` 0 行、文書・チャンク・件数・検索すべて 0、Storage の PDF はテスト・internal とも取得不可、アプリの PDF API（テスト・internal）とチャット API は 403、画面は「利用権限がありません」
- 結果ファイル: `reports/sectest/2026-11-23T15-26-14-302Z-verify.md`（UTC 表記・Git 管理外）

### 判定

| # | 判定 | 根拠 |
| --- | --- | --- |
| T-1 | **合格** | 未登録ユーザーは DB・Storage・検索で何も取得できず、API はすべて 403、画面は「利用権限がありません」。チャット API は認可で止まり AI API は呼ばれていない |
| T-2 | **合格** | department 文書は一覧・件数・ID 指定・検索（同一ベクトルでも出ない）・出典・Storage・PDF API（404）のいずれにも現れない |
| T-3 | **合格** | restricted 文書も T-2 と同じ項目で現れない |

**範囲の注意**: 今回の department 文書は、どの利用者の部署とも一致しない架空の部署名で作成した。現在の RLS は internal のみを許可するため、「部署が一致する利用者には見える」機能は未実装（Phase 2 の部署別アクセス制御で実装・検証する）。
