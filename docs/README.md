# 納品資料一覧

社内文書検索AI（RAG）Phase 1 の資料です。状態の凡例: ✅ 完了 / ⏳ 実環境での検証後に追記

## 概要・設計

| 資料 | 内容 | 状態 |
| --- | --- | --- |
| [REQUIREMENTS.md](./REQUIREMENTS.md) | システム概要・要件定義（機能・非機能要件、対象外、受け入れ基準） | ✅ |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | アーキテクチャ図（Mermaid: 構成図・シーケンス図・ER 図）、共通仕様・API・データ形式 | ✅ |
| [SECURITY.md](./SECURITY.md) | セキュリティ設計書（認可・RLS・Storage・秘密情報・LLM 対策、レビュー結果、残る懸念点） | ✅ |

## 構築・利用・運用

| 資料 | 内容 | 状態 |
| --- | --- | --- |
| [SETUP.md](./SETUP.md) | 初期設定マニュアル（Supabase Dashboard の手順、SQL 実行順・確認・失敗時対応、API・費用、Vercel デプロイ） | ✅ |
| [USER_GUIDE.md](./USER_GUIDE.md) | 利用者向け操作マニュアル | ✅ |
| [OPERATIONS.md](./OPERATIONS.md) | 管理者向け運用手順書（利用者管理、**PDF 追加・更新・再 Embedding・削除**、費用監視、キー管理、障害対応） | ✅ |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | トラブルシューティング | ✅ |
| [SECURITY_TEST_T1-T3.md](./SECURITY_TEST_T1-T3.md) | 実環境セキュリティテスト T-1〜T-3（未登録ユーザー・部署限定・restricted）の手順・クリーンアップ・結果記録 | ✅ 2026-11-24 実施・合格 |
| [DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md) | Vercel 公開前チェックリスト（公開前の必須事項、環境変数と設定場所、Preview の保護、Firewall・プラン別の対応、Supabase Auth の URL、デプロイ後の確認手順） | ✅ / ⏳ 公開後に記入 |
| [GITHUB_PUBLISH.md](./GITHUB_PUBLISH.md) | GitHub 公開準備（公開用リポジトリの作り方・確認結果、除外ファイル、推奨リポジトリ名、push 手順、今後の更新方法） | ✅ |

## 品質・プロジェクト管理

| 資料 | 内容 | 状態 |
| --- | --- | --- |
| [EVALUATION.md](./EVALUATION.md) | 精度検証の方法と結果記録（モック・実 API の結果記録済み。応答時間は再測定待ち） | ✅ / ⏳ |
| [DELIVERY_CHECKLIST.md](./DELIVERY_CHECKLIST.md) | 納品チェックリスト（完了・検証待ち・未実施） | ✅ |
| [WBS.md](./WBS.md) | WBS・見積もりと実績の比較 | ✅ / ⏳ |
| [PHASE2_PROPOSAL.md](./PHASE2_PROPOSAL.md) | Phase 2 提案書・概算見積もり（教材の参考値） | ✅ |
| [RETROSPECTIVE.md](./RETROSPECTIVE.md) | 振り返り（KPT） | ✅ / ⏳ |

## 機能別の技術資料（開発者向け）

| 資料 | 内容 |
| --- | --- |
| [INGEST.md](./INGEST.md) | 文書取り込みの処理・チャンク設計・再取り込みの挙動 |
| [SEARCH.md](./SEARCH.md) | 検索・回答生成・出典検証・設定値 |
| [UI.md](./UI.md) | 画面構成・認証フロー・出典 PDF の権限確認 |

## 関連ファイル

| パス | 内容 |
| --- | --- |
| `supabase/migrations/` | DB マイグレーション（適用順はファイル名順） |
| `supabase/verify/02_security_checklist.sql` | 適用後の一括セキュリティチェック（41 項目・OK/NG 表示・読み取りのみ） |
| `supabase/verify/03_sectest_state.sql` | T-1〜T-3 の作成前・作成後・削除後の件数と ID の照合（読み取りのみ） |
| `supabase/verify/01_after_migration_checks.sql` | 適用後の個別確認クエリ（読み取りのみ） |
| `supabase/verify/99_rollback_dev_only.sql` | 開発用プロジェクト専用のロールバック |
| `.env.example` | 環境変数のテンプレート（値は空） |
| `vercel.json` | Vercel の設定（関数リージョン `hnd1`。環境変数は書かない） |
