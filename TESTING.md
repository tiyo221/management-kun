# TESTING.md — テスト指針

モジュールが増えても回帰を防ぐためのテスト方針。**アプリ本体と同じく依存ゼロ**（Node 標準のみ）で、
回帰の主戦場である**ロジックは自動テスト**、DOM/見た目の**view は手動チェックリスト**で担保する。

- 自動テスト: `shared/*` と各モジュールの `logic.js`（純粋な計算・CRUD・CSV・名寄せ）。
- 手動テスト: view（描画・操作・レスポンシブ・ダーク）は [`CONVENTIONS.md`](CONVENTIONS.md) §6 の完成チェックリスト＋プレビューのスモーク。

---

## 1. 基本方針

- **修正した機能は、そのモジュールのテストを行う**（変更したモジュールの `*.test.js` を実行／不足なら追加）。
- **依存関係がある場合は、依存している側もテストする**（波及範囲は §2 のマトリクス）。
- **バグ修正には再発防止テストを1つ足す**（同じ指摘を繰り返さない）。
- **境界値・異常系を必ず含める**: 空データ、割当100超（過剰アサイン）、依存の循環、全角/半角の名寄せ、週境界（月曜始まり）、日付逆転、未評価/対象外(`-`) など。
- **I/O・移行の回帰**: JSON エクスポート→インポートのラウンドトリップ、CSV ラウンドトリップ、旧データ移行。
- **テストは決定的に**: 「今日」に依存させない（固定日付・固定の月曜を使う）。
- **依存ゼロ・ネットワークなし**: テストも npm パッケージを使わない（Node 標準のみ）。

---

## 2. 変更影響マトリクス（何を変えたら何をテストするか）

| 変更した場所 | テスト対象 | 手段 |
|---|---|---|
| `modules/<id>/logic.js` | その `<id>` のロジック | 自動（`test/<id>.test.js`） |
| `modules/<id>/view.js` | その `<id>` の画面 | 手動スモーク（描画・操作） |
| `shared/core.js` / `store.js` / `io.js` | **全モジュール**（全部が依存） | 自動フルスイート＋全モジュール手動スモーク |
| `shared/scope.js`（スコープ次元） | **wbs**（project-scoped）・**シェル**（スイッチャ / `ctx.scope`） | 自動（`scope` / `wbs-scope`）＋切替の手動確認 |
| `shared/people.js` / `projects.js`（マスタ） | **skills / wbs / todo / resource / oneonone**（マスタを参照） | 自動＋該当画面の手動確認 |
| `shared/products.js`（マスタ） | **releases / dashboard**（Product マスタを参照） | 自動＋該当画面の手動確認 |
| `shared/allocations.js` / `demands.js`（共有マスタ） | **resource / dashboard**（要員計画・ダッシュボードがアロケーションを参照） | 自動（`allocations` / `demands` / `resource` / `dashboard`）＋要員計画・ダッシュボード画面の手動確認 |
| `modules/wbs/logic.js`（進捗集計） | **dashboard**（WBS 進捗を対象別に集約する横断ビュー） | 自動（`dashboard`）＋ダッシュボード画面の手動確認 |
| `shared/ui.js` / `design.css`（見た目の共通） | **全モジュールの view** | 手動（375/768/1280・ダーク・空状態） |
| `index.html` / `shared/shell*.js`（シェル/ナビ/移行/設定。責務別分割・Issue #140） | シェル・該当移行 | 手動（切替・バックアップ・移行） |

> 各モジュールは基本独立で、共通の依存は「shared」と「人/プロジェクトのマスタ」。例外は **dashboard**（横断集約ビュー）で、共有マスタに加え **wbs の対象別データ（`exportData(projectId)`）を読み取り専用で集約**する（編集はしない）。wbs の進捗集計を変えたら dashboard も確認する。

---

## 3. レイヤ別の担保方法

| 対象 | 種別 | 手段 |
|---|---|---|
| ロジック（計算・集計・CRUD・CSV整形/取込・名寄せ） | 自動ユニット | `node test/run.js` |
| shared（util / io / store / people / projects / products / allocations / demands / scope） | 自動ユニット | 同上 |
| view（描画・イベント） | 手動スモーク | プレビューで「描画される・コンソールエラーゼロ」 |
| レイアウト・レスポンシブ・ダーク | 手動 | 375 / 768 / 1280px ＋ テーマ切替（CONVENTIONS §2.2 / §6） |
| 全体 I/O・旧データ移行 | 自動（ロジック）＋手動（UI） | ラウンドトリップの自動テスト＋設定画面での実操作 |

---

## 4. 自動テストの実行

```
node test/run.js
```

- 追加インストール不要（Node 標準のみ）。全テストが通れば `0 passed 表示 / 終了コード 0`、失敗があれば終了コード 1。
- 構成:
  - `test/harness.js` … `shared/*` と各 `modules/<id>/logic.js` を Node 上に読み込み、`window.MK` を組み立てる（DOM は最小スタブ）。
  - `test/run.js` … `test/*.test.js` を自動収集して実行。グローバルに `test` / `assert` / `eq` / `almost` を提供。
  - `test/<name>.test.js` … 各テスト。テストごとにデータは自動リセットされる。

---

## 5. テストの書き方

`test/<id>.test.js` を作り、`test(名前, (MK) => { ... })` を並べる。ロジックは `MK.logic["<id>"]`、マスタは `MK.people` / `MK.projects` を使う。

```js
"use strict";
test("wbs: 依存の循環を検出", (MK) => {
  // 観点: 循環を生む依存追加は検出して拒否する（不正な依存を作らせない）
  // 入力: サンプルは t3.deps=[t2]。逆向きの t2→t3 を張ろうとする
  // 期待: depsCreatesCycle=true（検出）/ addDep=false（追加は拒否）
  const W = MK.logic.wbs;
  W.loadSample();
  const tasks = W.tasks();
  assert(W.depsCreatesCycle(tasks, tasks[1].id, tasks[2].id));
  eq(W.addDep(1, tasks[2].id), false);
});
```

- **各テストは冒頭に「観点 / 入力 / 期待」の3行コメントを付ける**（何を確かめる意図か・どんな入力/シナリオか・どうなるべきか）。関連する仕様があれば §番号や Issue 番号を添える。実装から自明でない値（例: 平均の計算式、`unshift` の並び）はインラインコメントで補う。
- 使えるアサーション: `assert(cond, msg)` / `eq(actual, expected, msg)`（JSON 比較）/ `almost(a, b, msg)`（浮動小数）。
- データは `test` ごとに `reset` される（`localStorage` とストアキャッシュをクリア）。各テストは必要なデータを自分で用意する（`loadSample()` か直接 CRUD）。
- **新規モジュールを追加したら、その `logic` のテストも `test/<id>.test.js` に追加する**（CONVENTIONS §5 の追加手順に含める）。

---

## 6. 実行タイミング

- モジュールを「完了」とする前（CONVENTIONS §6 DoD）に、該当分の自動テストと手動スモークを行う。
- `shared/*` を変更したら**全自動テスト＋全モジュール手動スモーク**。
- 変更を確定（コミット/PR）する前に `node test/run.js` が緑であること。

---

## 7. 現状のカバレッジ（自動）

`test/*.test.js` の一覧（`node test/run.js` で自動収集・実行）:

- **shared**（`shared.test.js`）: `util`（名寄せキー・日付）、`io.csv`（ラウンドトリップ）
- **people** / **projects** / **products**: マスタ CRUD・名寄せ（resolve / resolveOrCreate）・CSV upsert
- **allocations**: 人×器×期間×% の CRUD・`percentOn`（期間内合算）
- **demands**: 器×期間×必要% の CRUD・`demandOn` / `totalDemandOn`
- **scope**: スコープ次元の汎用走査（Project / Product・`"project"` 決め打ちしないこと）
- **wbs-scope**: wbs の対象別 namespace（`mk:module:wbs:<projectId>`）分離
- **summary**: 各モジュールの `summary()`（HOME カード集計）
- **module-meta**: 全モジュール def が1行説明 `description` を持つこと（HOME の見取り図・Issue #40。view.js を読み込んで検証）
- **spec-consistency**: spec.md §5 のモジュール一覧表が実装と一致すること（id ⇄ index.html のロード対象／CSV✓ ⇄ `build…CSVRows` を持つモジュール。仕様の陳腐化を検出・Issue #117）
- **todo**: 追加/件数/完了/フィルタ
- **goals**: 進捗・いまここ・全完了で達成
- **questions**: 追加/解決/フィルタ
- **skills**: 平均・ギャップ判定・紐づけCSVラウンドトリップ
- **resource**: 要員計画（空き＝キャパ−全器割当）・横断集計・アロケーション吸い上げ移行（退役 workload → 共有マスタ・#167）
- **oneonone**: 1on1メモの CRUD
- **wbs**: ロールアップ・WBS番号・依存循環・削除/元に戻す・日付逆転（開始>終了は不正入力として拒否）
- **dashboard**: PJ 横断集約（WBS 進捗・期限超過の基準日判定・対象PJのアロケーション/関連プロダクト抽出）
- **techstack**: 技術スタック台帳の CRUD・CSV ラウンドトリップ
- **releases**: 必須項目（プロダクト・バージョン）・時系列ソート・ステータス正規化・直近予定・削除済み Product 参照ガード

view（描画・レスポンシブ・ダーク）は自動化対象外（手動スモーク＋DoD）。将来 DOM テストが必要になれば、依存ゼロ方針とのトレードオフを検討する。
