# モジュール統廃合 移行テンプレート（consolidation.md）

Phase 3 の**モジュール統廃合**（`mk:module:a` → `mk:module:b` の統合移行）を、汎用マージエンジンを作らず **one-off の移行スクリプト方式**で行うための型（手順書＋スクリプト骨格＋テストパターン＋後始末の作法）。統廃合を1件やるたびにこのファイルをコピー元にして各回の負担を抑える。

- 位置づけ: [`spec.md`](../spec.md) §9.6（Phase 3 の方向・廃止作法）の実務テンプレート。判断そのもの（統合するか）の記録は §9.6 の決定ログ表に1行追記する。**本テンプレートは「統合すると決めた後」の実行手順**を扱う。
- 旧ツール→マネジメントくんの移行（[`import-migration.md`](import-migration.md) §7）とは別物: あちらは**旧 localStorage / 旧 JSON → 新エンベロープ**、こちらは**モジュール名前空間 → モジュール名前空間**（マネジメントくん内部）。名寄せ（§8）・名前参照解決の共通処理は import-migration.md を正として再利用する。
- 汎用化しない: 共有 API（`shared/*`）へ再利用ヘルパを足さない。移行ロジックは**その回限りの関数**として shell の起動シーケンスに置き、実行後は不要になる（後始末で撤去してよい）。2回目・3回目もこのファイルからコピーして作り直す（YAGNI・[`CODING.md`](../CODING.md)）。

> **第一候補**: `workload` → `resource`（`workload` は Issue #52 でナビ降格済み・登録は維持）。本書の例はこの統合を想定して書くが、対象は毎回読み替える。

---

## 1. 統合前チェックリスト

統合スクリプトを書き始める前に、次を確認して受け皿を設計する。**1つでも詰まっていたら統合しない／設計に戻る。**

- [ ] **役割の重複を確認した**: 統合元 `a` と統合先 `b` の役割が実際に重なり、`a` を畳んで `b` に寄せることがユーザーの意思決定を損なわない（`a` 固有で `b` に無い機能が捨てられないか）。判断は [`spec.md`](../spec.md) §9.6 の決定ログ表に1行残す。
- [ ] **データ量・スキーマ差分を確認した**: `mk:module:a:v1`（scoped なら `mk:module:a:<targetId>:v1` も全対象分）の件数・形状と、`b` の受け皿スキーマの差分を洗い出した。`a` にあって `b` に無いフィールドの扱い（捨てる／`b` のスキーマを version 上げて受ける）を決めた。`b` のスキーマ拡張が要るなら [`spec.md`](../spec.md) §4.5 のマイグレーション連鎖（`MK.migrations["module:b"]`）を先に用意する。
- [ ] **統合先の受け皿を設計した**: `b` 側に取り込み口（`MK.modules.b.importData(payload, mode)` 等の既存 API、無ければ追加）があり、`a` の各レコードが `b` のどのレコードへ写るか（1:1／集約／分割）が決まっている。
- [ ] **マスタ参照は維持する方針を確認した**: `a` が持つ People/Project/Product 参照（`memberId` / `projectId` / `productId`）は**再解決せずそのまま引き継ぐ**（同一マスタを指す id は移行後も有効）。名前しか持たない旧データが混じる場合のみ §8 名寄せ（`resolveOrCreate`）を通す。
- [ ] **JSON バックアップ導線を案内した**: 実行前に**モジュール単位 JSON エクスポート**（`a` と `b` の両方・`scope:"module"`）を取るよう UI で案内する。破壊的操作の前に退避できる導線（[`spec.md`](../spec.md) §10.1）を必ず提示する。

---

## 2. one-off 移行スクリプトの骨格

`shared/shell.js` の起動シーケンス（`MK.store.load()` の後・`route()` の前。既存の `migrateScopedData()` / `MK.allocations.migrateFromWorkload()` と同じ並び）に、その回限りの関数として置く。**握りつぶさない・部分適用しない・冪等**の3点を守る（[`spec.md`](../spec.md) §10.1）。

```js
// 例: workload → resource の一回的統合（Issue #NNN）。統合が済んだら本関数ごと撤去する。
// 骨格の要点:
//   1. 実行済みフラグ（mk:settings.migration）でガードし冪等にする（§4.8）。
//   2. 読み → 変換 → 書きを「全部そろってから一括 write」。途中で throw したら
//      何も書かずに中断し、理由を表示する（部分適用しない・§10.1）。
//   3. マスタ参照（memberId 等）は再解決せず引き継ぐ。名前しか無い旧データのみ名寄せ。
function migrateWorkloadToResource() {
  const FLAG = "workloadToResource"; // mk:settings.migration.<FLAG>
  const settings = getSettings();
  if (settings.migration && settings.migration[FLAG]) return; // 実行済み＝何もしない（冪等）

  const src = MK.store.read("module:workload"); // scoped なら対象ごとに keyOf("module:workload:"+targetId)
  if (!src || !hasMigratableData(src)) {
    // 元データが無い（新規ユーザー等）＝移行不要。フラグだけ立てて以後スキップ。
    setSettings({ migration: { [FLAG]: true } });
    return;
  }

  // --- 変換（純粋・副作用なし）。ここで throw しても localStorage は未変更のまま ---
  let payload;
  try {
    payload = buildResourcePayload(src); // a のレコード → b の受け皿形状。id 再マッピングもここで
  } catch (e) {
    // 変換に失敗＝スキーマ想定外。無言で握りつぶさず理由を出し、フラグは立てない（再実行可能）。
    MK.ui.toast("workload → resource の移行に失敗しました（データ形式を確認してください）", "error");
    console.error("consolidation workload→resource:", e);
    return; // 部分適用しない
  }

  // --- 書き（ここまで来たら一括で確定）---
  MK.modules.resource.importData(payload, "merge"); // 受け皿の取り込み口。replace/merge は受け皿設計で決める
  setSettings({ migration: { [FLAG]: true } }); // 実行済みフラグ

  // 旧名前空間の後始末は §4 の作法に従う（自動削除しない／別導線で案内）。
}
```

**ID 再マッピングの指針**

- **マスタ参照（`memberId` / `projectId` / `productId`）**: 触らない。移行後も同じマスタ id を指せば横断参照が保たれる。
- **モジュール内部 id**（`a` 固有の `wt_…` 等）: `b` の採番規約（[`spec.md`](../spec.md) §4.7）に合わせて振り直す。`a` 内部で id を相互参照している場合（依存・親子）は**旧 id → 新 id の対応表**を作り、参照側も付け替える（shell の旧移行 `skills` の `skillMap` / `memMap` が実例）。
- id は**再利用しない**（§4.7）。

**scoped モジュールの場合**

- `a` が scoped（`mk:module:a:<targetId>:v1`）なら、対象（`MK.scope`）を総なめして対象ごとに読み・変換し、`b` の対応する対象へ書く。対象別キーの読み書きは `MK.store.keyOf("module:a:" + targetId)` / `MK.store.read("module:a:" + targetId)`（`migrateScopedData()` が実例）。

---

## 3. 移行テストの書き方

`test/harness.js` 上で「**移行前データ投入 → 移行実行 → 統合先で読める・元データが指定どおり扱われる**」を検証する。移行関数は shell 内のクロージャで直接呼べないため、**変換部（`buildResourcePayload` 相当）を logic 側の純関数として切り出し**、それを単体テストするのが基本形（DOM 非依存＝ harness で動く。[`CONVENTIONS.md`](../CONVENTIONS.md) の logic/view 分割と整合）。冪等・非破壊・失敗時中断も検証する。

```js
/* 例: workload → resource 統合移行のテスト（Issue #NNN） */
"use strict";

// 変換部は b の logic（または移行専用 logic）に純関数として置き、ここから呼ぶ。
test("consolidation: workload の各レコードが resource の受け皿へ写る", () => {
  const src = { version: 1, tasks: [{ id: "wt_1", memberId: "m_a", load: 30 }] };
  const payload = MK.logic.resource.buildFromWorkload(src); // 純関数＝副作用なし
  eq(payload.items.length, 1);
  eq(payload.items[0].memberId, "m_a", "マスタ参照（memberId）は再解決せず引き継ぐ");
  assert(payload.items[0].id !== "wt_1", "モジュール内部 id は b の規約で振り直す");
});

test("consolidation: 元データが無ければ空を返す（新規ユーザーで既定データを作らない）", () => {
  eq(MK.logic.resource.buildFromWorkload(null), null);
  eq(MK.logic.resource.buildFromWorkload({ version: 1, tasks: [] }), null);
});

test("consolidation: 内部参照（依存・親子）を持つ場合、新 id へ付け替わる", () => {
  const src = { version: 1, tasks: [
    { id: "wt_1", memberId: "m_a" },
    { id: "wt_2", memberId: "m_a", parent: "wt_1" },
  ] };
  const payload = MK.logic.resource.buildFromWorkload(src);
  const child = payload.items.find((i) => i.srcId === "wt_2");
  const parent = payload.items.find((i) => i.srcId === "wt_1");
  eq(child.parent, parent.id, "旧 id 参照が新 id へ付け替わる");
});

test("consolidation: 冪等 — 実行済みフラグが立っていれば store を変更しない", () => {
  // フラグ方式の検証は store レベルで行う。移行関数を2回呼んでも b が増えないことを確認する。
  // （shell 内クロージャを直接呼べない場合は、変換部の純関数＋フラグ判定を分けてそれぞれ検証する）
});
```

**検証の観点（最低限）**

1. **写像**: `a` の各レコードが `b` の期待形へ写る（件数・主要フィールド）。
2. **マスタ参照の保持**: `memberId` / `projectId` / `productId` が再解決されず不変。
3. **id 再マッピング**: 内部 id は振り直され、内部参照（依存・親子）も新 id へ付く。
4. **空/未存在**: 元データ無しで既定データを作らない（`null` を返す等）。
5. **冪等**: 2回実行しても二重取り込みしない（フラグ or 対応表で防ぐ）。
6. **失敗時中断**: 変換が throw する不正データで、`b` が一切変更されない（部分適用しない）。

---

## 4. 旧名前空間の後始末の作法

統合が済み、`b` 側で運用が回ることを確認したら、`a` の名前空間を撤去する。**専用の廃止機構は作らず、手順として運用する**（[`spec.md`](../spec.md) §9.6 廃止作法と同期）。

1. **モジュール単位 JSON エクスポート**: `a` を `scope:"module"` で書き出して退避する（万一の巻き戻し用）。scoped なら対象別に全件。
2. **キー削除**: `mk:module:a:v1`（scoped なら全 `mk:module:a:<targetId>:v1`）を削除する。削除は移行スクリプトで自動化せず、**設定画面の明示操作**か**次リリースの撤去コミット**で行う（誤削除・巻き戻し不能を避ける）。
3. **登録の撤去**: `a` の `index.html` ロード行・`modules/a/`・`spec/modules/a.md`・§5 一覧表の行を削除する（§5 表の更新は `test/spec-consistency.test.js` が検出する）。ナビ降格だけで畳む段階なら `hiddenModules`（§4.8）に留め、キー削除まではしない。
4. **移行スクリプトの撤去**: §2 の one-off 関数と shell の呼び出しは、全ユーザーの移行が済んだ後に撤去してよい（実行済みフラグが立っているため再実行されない）。撤去はドキュメント（本書のコピー元＝各回の Issue）に記録を残す。

> **注意**: キー削除は不可逆。§1 の JSON バックアップ案内と本節の手順1を飛ばさない。`a` に `b` へ写しきれなかったデータが残っていないこと（写像の網羅性）を、削除前にテスト（§3 観点1）とデータ量突き合わせ（§1）で担保する。
