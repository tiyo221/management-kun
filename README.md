# マネジメントくん

既存の5つの単一HTMLツール（目標みえるくん / スキル可視化 / タスク可視化 / todo-kun / WBS）を、**共通デザイン・共通データ規格・共通マスタ**のもとに1つへ統合した、マネージャ向けの管理ツール。

- **ビルド不要・外部依存ゼロ・オフライン完結**。データはブラウザの `localStorage`（`mk:` プレフィックス）に保存し、外部送信しない。
- 構成は「単一ページ・シェル ＋ 共有資産（`shared/`）＋ モジュール（`modules/`）」。ES Modules / `fetch` は使わず、classic `<script>` ＋ `window.MK` 名前空間で連携する。

## 使い方

[`index.html`](index.html) をブラウザで直接開く（`file://`）か、任意の静的サーバーで配信する。

```
npx --yes http-server -p 8777 -c-1
```

初回は「設定」→「サンプルデータを読み込む」で動作を確認できる。旧ツールのデータがあれば「設定」→「旧ツールから移行」で取り込める。

## 機能（モジュール）

ナビは「自分＋EM が見る領域」で分類（マネージャの作業机。spec §1.4）。左サイドバーにゾーン見出し＋配下モジュールを縦積みする（狭幅ではドロワー化）:

- **自分**（ToDo・目標 ほか）／ **ピープル**（スキル・要員計画 ほか）／ **デリバリー**（WBS）／ **プロダクト**（リリース台帳）／ **テクノロジー**（技術スタック）
- **マスタ**: 👤 人 ／ 📁 プロジェクト ／ 📦 プロダクト（全モジュール横断で参照する共通マスタ）
- ⚙ 設定: 全体バックアップ（JSON 入出力）・サンプル投入・旧ツール移行・テーマ切替（ダークモード）・モジュールの表示/非表示切替

> **モジュールの一覧（id・ゾーン・CSV 対応）は [`spec.md`](spec.md) §5 のモジュール一覧表を正とする。** 各ゾーンに何を載せるかはエントリ HTML の `MK_CONFIG.zones`（[`index.html`](index.html) / [`member.html`](member.html)）が正。CSV 入出力の対象は spec §4.6 を参照。

## ドキュメント

| 文書 | 役割 |
|---|---|
| [`spec.md`](spec.md) | **何を作るか（共通）**。アーキテクチャ・共通データ規格（JSON/CSV/localStorage）・名寄せ・デザイン統一・フェーズ。**最上位の正** |
| [`spec/masters.md`](spec/masters.md) | 共通マスタ（§4.4）: マスタ共通契約＋People / Project / Allocation / Product の定義。マスタ追加・修正時に参照 |
| [`spec/import-migration.md`](spec/import-migration.md) | 取り込み・移行・名寄せ（§4.6 CSV 規約 / §7 旧データ移行 / §8 名寄せ）。取込・移行作業時のみ参照 |
| [`spec/consolidation.md`](spec/consolidation.md) | モジュール統廃合（module→module 統合）の移行テンプレート（§9.6）。手順書＋one-off スクリプト骨格＋テストパターン＋後始末。統廃合を実施する時のみ参照 |
| [`spec/modules/<id>.md`](spec/modules/) | **何を作るか（モジュール個別）**。各モジュールの位置づけ・固有データ・CSV 列・旧データ移行 |
| [`CLAUDE.md`](CLAUDE.md) | **どう作るか**。作業ガイド・開発ワークフロー（コーディング規約は CODING.md） |
| [`CODING.md`](CODING.md) | コーディング規約（言語/実行環境・モダン JS・構造/命名・安全・オーバーエンジニアリング防止） |
| [`CONVENTIONS.md`](CONVENTIONS.md) | UI/レイアウト規約・logic/view 分割・共有資産リファレンス・**新規モジュール追加手順**・完成チェックリスト |
| [`TESTING.md`](TESTING.md) | テスト指針・変更影響マトリクス・自動テストの実行/書き方（`node test/run.js`） |
| [`DESIGN.md`](DESIGN.md) | Notion 風デザインシステム（トークン・コンポーネント） |

新しくモジュールを足す・直すときは、まず [`CONVENTIONS.md`](CONVENTIONS.md) を参照する。
