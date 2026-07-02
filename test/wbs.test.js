/* wbs ロジック（ロールアップ・WBS番号・依存循環・削除/元に戻す） */
"use strict";

test("wbs: サンプルのロールアップと WBS番号", (MK) => {
  // 観点: 親の進捗は葉の平均でロールアップされ、WBS番号は階層順に採番される
  // 入力: サンプル（親1件＋葉4件、葉の進捗 100/60/20/0）を読み込む
  // 期待: 番号=[1, 1.1〜1.4] / 先頭は親 / 親の進捗=(100+60+20+0)/4=45
  const W = MK.logic.wbs;
  W.loadSample();
  const tasks = W.tasks();
  eq(W.wbsNumbers(tasks), ["1", "1.1", "1.2", "1.3", "1.4"]);
  assert(W.isParent(tasks, 0), "先頭は親");
  eq(W.summaryOf(tasks, 0).progress, 45);
});

test("wbs: 依存の循環を検出・防止", (MK) => {
  // 観点: 依存関係に循環を生む追加は検出して拒否する（不正な依存を作らせない）
  // 入力: サンプルは t3.deps=[t2]。ここへ t2→t3 の依存を張ろうとする（逆向きで循環）
  // 期待: depsCreatesCycle=true（検出）/ addDep=false（追加は拒否）
  const W = MK.logic.wbs;
  W.loadSample();
  const tasks = W.tasks();
  const t2 = tasks[1].id, t3 = tasks[2].id;
  assert(W.depsCreatesCycle(tasks, t2, t3), "循環を検出");
  eq(W.addDep(1, t3), false);
});

test("wbs: 削除と元に戻す", (MK) => {
  // 観点: タスク削除は件数へ反映され、undo で元の状態に完全復元できる
  // 入力: サンプル5件 → 葉 t2（index 1）を削除 → undoDelete()
  // 期待: 5 → 削除後4 → undo で 5 に戻る
  const W = MK.logic.wbs;
  W.loadSample();
  eq(W.tasks().length, 5);
  W.deleteTask(1);
  eq(W.tasks().length, 4);
  W.undoDelete();
  eq(W.tasks().length, 5);
});
