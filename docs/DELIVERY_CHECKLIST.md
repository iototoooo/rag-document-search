# 納品チェックリスト

凡例: ✅ 完了（確認済み） / ⚠ 確認したが目標未達 / ⏳ 実環境での検証待ち / ⬜ 未実施 / ❓ 未確認（確認の記録なし）

最終更新: 2026-11-24（Vercel 本番デプロイ後。本番 URL: https://rag-document-search-amber.vercel.app ）

## 1. 機能

| 項目 | 状態 | 確認方法・根拠 |
| --- | --- | --- |
| PDF 取り込み（抽出・正規化・チャンク・Embedding） | ✅ 実 API・実 DB（2026-11-23、5 件・14 チャンク。2026-11-24 に DB の登録数を読み取りで再確認） | `npm run ingest -- --execute`、`src/lib/ingest/*.test.ts` |
| PDF 200 件規模の取り込み | ⬜ **未実施**（学習用サンプル 5 件で検証。追加の取り込みは行わない方針） | [REQUIREMENTS.md](./REQUIREMENTS.md) |
| 再取り込みで重複しない | ✅ ローカル / ⏳ 実 DB | `pipeline.test.ts`、統合テスト |
| ベクトル検索（しきい値・件数の設定） | ✅ 実 DB（RLS 適用の pgvector 検索） | `npm run verify:db`、`supabase-searcher.test.ts` |
| Claude による根拠付き回答・出典（ファイル名・ページ） | ✅ 実 API（12/12） | [EVALUATION.md](./EVALUATION.md) 5 章 |
| 根拠なし時「該当する情報が見つかりません」 | ✅ 実 API（Q11・Q12 2/2） | 同上 |
| 存在しない出典を返さない | ✅ | `citations.test.ts`、実 API で出典正確性 100% |
| チャット画面（入力・ローディング・エラー・出典） | ✅ PC ブラウザ（ローカル・本番 URL とも利用者が確認） / ⏳ スマートフォン実機 | 画面確認 |
| 出典 PDF を権限確認のうえ該当ページで開く | ✅ 実環境（ローカルアプリ + 実 DB、本番 URL） | 画面確認、`verify:db`（PDF API 200 / 401）。本番では未ログインで PDF の URL を開いても表示されないことを利用者が確認 |
| ログイン・ログアウト（サインアップなし） | ✅ 実環境（ローカルアプリ + 実 Auth、本番 URL） | 画面確認、`sectest verify` |
| 本番 URL での回答生成 | ✅ 利用者が確認（2026-11-24） | 画面確認 |

## 2. 品質・精度

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| 型チェック・lint・全テスト・本番ビルド | ✅ | 2026-11-24 実施（公開用リポジトリ: 30 ファイル・248 件。架空のテストデータを使用） |
| 精度検証の仕組み（12 問・指標・モック/実 API の区別） | ✅ | `npm run eval`、[EVALUATION.md](./EVALUATION.md) |
| 正答率 80% 以上 | ✅ **100%（12/12）**（2026-11-23・実 API 1 回。学習用サンプル 5 文書・テスト質問 12 問での実測） | [EVALUATION.md](./EVALUATION.md) 5 章 |
| 文書に記載のない 2 問で「該当なし」 | ✅ **2/2**（同上） | 同上 |
| 応答時間 5 秒以内（p95） | ⚠ **未達**（中央値 2.0 秒・最大 7.7 秒。12 問中 11 問は 1.7〜2.7 秒、Q4 のみ 7.7 秒で p95 7.7 秒） | 原因は未特定。段階別の計測を追加済みで、再測定は未実施。ローカルでの測定で、Vercel 本番での応答時間は未測定（[EVALUATION.md](./EVALUATION.md) 5 章） |

## 3. セキュリティ

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| 全テーブル RLS 有効・ポリシーは SELECT のみ | ✅ 実 DB | 確認 SQL `02_security_checklist.sql`（41 項目すべて OK） |
| 検索 RPC が RLS を迂回しない（security invoker） | ✅ 実 DB | 同上、`verify:db` |
| 部署限定・restricted 文書が一般利用者に出ない | ✅ 実 DB | [T-2・T-3](./SECURITY_TEST_T1-T3.md)（2026-11-24 合格） |
| `app_users` 未登録ユーザーの拒否 | ✅ 実 DB | [T-1](./SECURITY_TEST_T1-T3.md)（同上） |
| service_role はサーバー・取り込み CLI のみ | ✅ | コード確認（`admin.ts` は `scripts/ingest.ts` のみ）、Vercel に設定するとビルド中止 |
| Storage 非公開・PDF 閲覧時に認証・権限確認 | ✅ 実 DB | `verify:db`（公開 URL 400・anon 拒否・認証済みは取得可） |
| 未認証の API 拒否（401）・未許可（403） | ✅ ローカルアプリ + 実 DB | `verify:db`、`sectest verify` |
| 質問・本文・秘密情報をログに出さない | ✅ | `log.test.ts`、チャット API のテスト |
| 課金の上限設定（モデル許可リスト・再試行・出力上限・フォールバック無効・`maxDuration`） | ✅ | `env.test.ts`、`claude-generator.test.ts`、`tests/deploy/` |
| 各 API の利用上限・自動チャージ設定 | ✅ 利用者が確認（2026-11-24） | 各社の管理画面 |
| Vercel の環境変数 | ✅ 5 件を Production に登録。`OPENAI_API_KEY`・`ANTHROPIC_API_KEY` は Secret、その他 3 件は Config。Preview・Development への同じ変数の登録は見つかっていない / ❓ Shared 設定は未確認 | Vercel の管理画面（利用者が確認） |
| Vercel Firewall のレート制限（`/api/chat`・`/login`） | ✅ 1 件のルール内で OR 条件により両方を指定。IP ごと 60 秒 20 回（合算）、Deny（403）。設定後もログイン・AI 検索の正常動作を確認 / ❓ 超過時の動作は未検証 | Vercel の管理画面（利用者が確認） |
| Vercel Deployment Protection | ✅ Vercel Authentication ON（Standard Protection）で Preview を保護、Protected Sourcemaps ON | Vercel の管理画面（利用者が確認） |
| Supabase Auth の設定 | ✅ 新規登録 OFF、匿名ログイン OFF、メール確認 ON、パスワードは 16 文字以上・英大文字・英小文字・数字・記号が必須 | Supabase の管理画面（利用者が確認） |
| Supabase の URL 設定（Site URL・Redirect URLs） | ❓ 未確認（確認の記録なし） | [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) 6 章 |
| 本番のセキュリティヘッダー（HSTS・`X-Frame-Options`・`X-Robots-Tag`） | ✅ 本番 URL の応答で確認（2026-11-24） | `curl` で `/login` のヘッダーを確認 |
| 管理者パスワードの変更 | ✅ 管理 API で変更（2026-11-24）。新しいパスワードでログイン・ログアウト・再ログインを確認 | `auth.admin.updateUserById`（値は記録しない） |
| Supabase リージョンが東京 | ✅ 管理画面で確認（2026-11-24、Northeast Asia (Tokyo)・`ap-northeast-1`） | Supabase の管理画面（Project region） |
| 残る懸念点の共有 | ✅ | [SECURITY.md](./SECURITY.md) 第 8 章 |

## 4. 公開・Git

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| `.env.local`・PDF・CSV・`samples/`・`reports/` が Git 管理外 | ✅ | `.gitignore`。公開用リポジトリは履歴なしで新規作成（[GITHUB_PUBLISH.md](./GITHUB_PUBLISH.md)） |
| コミットの作者・コミッターが noreply | ✅ | `git log --format='%ae %ce'` |
| 秘密情報がコミットに含まれない | ✅ | `npm run scan:secrets` + 全コミット履歴の照合 |
| Vercel の設定（東京リージョン `hnd1`・`maxDuration`） | ✅ ファイル作成 / ❓ 関数の実行リージョンは管理画面で未確認 | `vercel.json`、`src/app/api/chat/route.ts`。本番 URL の `x-vercel-id` は `hnd1` で始まるが、静的ページの応答のため関数の実行リージョンは判別できない |
| GitHub へ push | ✅ 2026-11-24（https://github.com/iototoooo/rag-document-search 、`main`） | [GITHUB_PUBLISH.md](./GITHUB_PUBLISH.md) |
| Vercel デプロイ | ✅ GitHub の `main` を Production にデプロイ | 本番 URL: https://rag-document-search-amber.vercel.app |
| 公開後の安全確認 | ⏳ 大部分が完了（ログイン・回答・PDF 表示・未ログイン時の PDF 拒否・ヘッダー・環境変数・Deployment Protection・Firewall・Supabase Auth）。Supabase の URL 設定、関数の実行リージョン、レート制限超過時の動作が残る | [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) 0 章・7 章 |

## 5. 納品資料

| 資料 | 状態 |
| --- | --- |
| システム概要・要件定義（REQUIREMENTS.md） | ✅ |
| アーキテクチャ図（ARCHITECTURE.md・Mermaid の構成図・シーケンス図・ER 図） | ✅ |
| セキュリティ設計書（SECURITY.md）・実環境テスト記録（SECURITY_TEST_T1-T3.md） | ✅ |
| 初期設定マニュアル（SETUP.md） | ✅ |
| 利用者向け操作マニュアル（USER_GUIDE.md） | ✅ |
| 管理者向け運用手順書（OPERATIONS.md、PDF 追加・更新・再 Embedding を含む） | ✅ |
| トラブルシューティング（TROUBLESHOOTING.md） | ✅ |
| 精度検証結果の記録（EVALUATION.md） | ✅（応答時間は再測定未実施） |
| 公開チェックリスト（DEPLOY_CHECKLIST.md）・GitHub 公開準備（GITHUB_PUBLISH.md） | ✅ |
| Phase 2 提案書・概算見積もり（PHASE2_PROPOSAL.md） | ✅ |
| WBS・見積もりと実績（WBS.md） | ✅（工程 10 は未実施） |
| 振り返り（RETROSPECTIVE.md） | ✅（デプロイ時の問題・学び・Phase 2 の改善項目を記入済み） |
| README（本番 URL・運用手順・構成図・Phase 2 提案へのリンク） | ✅ |

## 6. 納品判定

以下がすべて ✅ になったら納品可:

- [x] 正答率 80% 以上・「該当なし」2 問が実 API で目標を満たし、EVALUATION.md に記録済み
- [ ] 応答時間 p95 5 秒以内（**未達**: 中央値 2.0 秒・最大 7.7 秒。再測定または目標の扱いを発注者と合意する）
- [ ] PDF 200 件規模の取り込み（**未実施**。学習用サンプル 5 件で検証済み。扱いを発注者と合意する）
- [x] SECURITY.md 第 9 章の実環境確認項目（T-0〜T-4）が確認済み
- [x] GitHub 公開・Vercel 本番デプロイ
- [ ] Vercel 公開後の安全確認（DEPLOY_CHECKLIST.md 7 章、SECURITY.md T-5）がすべて完了（大部分が完了。Supabase の URL 設定・関数の実行リージョン・レート制限超過時の動作が残る）
- [x] 各 API の利用上限が設定済み
