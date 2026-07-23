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

test("wbs: 日付逆転（開始 > 終了）を不正入力として弾く", (MK) => {
  // 観点: 開始 > 終了 になる更新は保存せず拒否する（TESTING.md §1 の必須境界「日付逆転」）
  // 入力: サンプル t3（index 2, start=今日+5, end=今日+9）の終了日を開始より前（今日+3）へ変更しようとする
  // 期待: datesInverted=true / update=false / end は元(+9)のまま。逆転しない更新(+15)は true で反映される
  const W = MK.logic.wbs;
  W.loadSample();
  const today = MK.util.todayISO();
  const start = W.tasks()[2].start, before = W.tasks()[2].end;
  const badEnd = MK.util.addDays(today, 3); // 開始(+5)より前 → 逆転
  assert(W.datesInverted(start, badEnd), "逆転を検出");
  eq(W.update(2, { end: badEnd }), false, "逆転する更新は拒否");
  eq(W.tasks()[2].end, before, "拒否時はデータ不変");
  const okEnd = MK.util.addDays(today, 15);
  eq(W.update(2, { end: okEnd }), true, "逆転しない更新は許可");
  eq(W.tasks()[2].end, okEnd);
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
  eq(W.undoDelete(), true, "退避があれば復元して true");
  eq(W.tasks().length, 5);
});

test("wbs: 削除後に別の変更が入ったら undo 退避を破棄する", (MK) => {
  // 観点: undo が保持するのは「直前に消した1件」だけ（CONVENTIONS §2.5-3）。削除以外の変更が
  //       入ると index がずれ、対象ストアも切り替わりうるため、退避は破棄して復元させない
  // 入力: (1) 削除 → 兄弟タスク追加 → undoDelete()  (2) 削除 → setStore で別対象へ → undoDelete()
  // 期待: どちらも復元されず（件数が増えない＝他データセット・ずれた位置へ挿し込まない）、
  //       undoDelete() は false を返す（view が「戻せなかった」と伝えられる＝無言で失敗しない）
  const W = MK.logic.wbs;
  W.loadSample();
  eq(W.deleteTask(1), undefined);
  W.addSibling(0);          // 削除以外の変更（配列長・位置が変わる）
  const afterEdit = W.tasks().length;
  eq(W.undoDelete(), false, "他の変更後は復元しない");
  eq(W.tasks().length, afterEdit);

  W.deleteTask(1);
  W.setStore(MK.store.scope("module:wbs:p_other")); // 対象（プロジェクト）切替
  const other = W.tasks().length;
  eq(W.undoDelete(), false, "対象切替をまたいで復元しない");
  eq(W.tasks().length, other);
});
