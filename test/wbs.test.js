/* wbs ロジック（ロールアップ・WBS番号・依存循環・削除/元に戻す） */
"use strict";

test("wbs: サンプルのロールアップと WBS番号", (MK) => {
  const W = MK.logic.wbs;
  W.loadSample();
  const tasks = W.tasks();
  eq(W.wbsNumbers(tasks), ["1", "1.1", "1.2", "1.3", "1.4"]);
  assert(W.isParent(tasks, 0), "先頭は親");
  // 葉の進捗 100/60/20/0 → 平均 45
  eq(W.summaryOf(tasks, 0).progress, 45);
});

test("wbs: 依存の循環を検出・防止", (MK) => {
  const W = MK.logic.wbs;
  W.loadSample();
  const tasks = W.tasks();
  const t2 = tasks[1].id, t3 = tasks[2].id;
  // t3.deps=[t2] なので t2→t3 を張ると循環
  assert(W.depsCreatesCycle(tasks, t2, t3), "循環を検出");
  eq(W.addDep(1, t3), false); // 追加は拒否される
});

test("wbs: 削除と元に戻す", (MK) => {
  const W = MK.logic.wbs;
  W.loadSample();
  eq(W.tasks().length, 5);
  W.deleteTask(1); // 葉 t2 を削除
  eq(W.tasks().length, 4);
  W.undoDelete();
  eq(W.tasks().length, 5);
});
