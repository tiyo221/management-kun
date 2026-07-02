/* workload ロジック（負荷計算・実効終了日） */
"use strict";

test("workload: 週次=日次負担の平均（均等割り）", (MK) => {
  // 観点: タスクの負担は期間内へ均等割りされ、週次負荷は日次負担の平均で表される
  // 入力: 月〜日の7日間ちょうどに負担30のタスク1件（週全体を覆う）
  // 期待: その週の週次負荷 ≈ 30（全日30なので平均も30）
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("テスト太郎");
  const mon = MK.util.mondayOf("2026-06-01");
  W.addTask({ memberId: mid, title: "x", load: 30, startDate: mon, endDate: MK.util.addDays(mon, 6), status: "in_progress" });
  almost(W.series(mid, [mon])[0], 30);
});

test("workload: 完了タスクは完了日を実効終了日にする", (MK) => {
  // 観点: 負荷を敷く終端は「予定終了日」ではなく状態に応じた実効終了日を使う
  // 入力(1): 完了・完了日1/5・予定終了1/10 / 入力(2): 進行中・完了日なし・予定終了1/10
  // 期待: (1) 完了日 1/5 を採用 / (2) 完了していないので予定終了 1/10 を採用
  const W = MK.logic.workload;
  eq(W.effEnd({ status: "done", completedDate: "2026-01-05", endDate: "2026-01-10" }), "2026-01-05");
  eq(W.effEnd({ status: "in_progress", completedDate: null, endDate: "2026-01-10" }), "2026-01-10");
});

test("workload: 100超はクランプしない", (MK) => {
  // 観点: 過負荷を可視化するため、合算が100%を超えても上限で丸めない（オーバーアロケーション検出）
  // 入力: 同一人物・同一週(月〜日)に負担80と50のタスク2件
  // 期待: その週の週次負荷 ≈ 130（100でクランプされない）
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("多忙さん");
  const mon = MK.util.mondayOf("2026-06-01");
  W.addTask({ memberId: mid, title: "a", load: 80, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  W.addTask({ memberId: mid, title: "b", load: 50, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  almost(W.series(mid, [mon])[0], 130);
});

test("workload/alloc: 1人を複数PJに期間×割当%で計画でき、保持される", (MK) => {
  // 観点: 共有アロケーション（人×器×期間×%）を複数器へ保持できる（§3.7.5 受け入れ条件）
  // 入力: 同一メンバーを PJ-A に60%、PJ-B に30%でアロケーション追加
  // 期待: allocations に2件保持され、器別・メンバー別の絞り込みが引ける
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("計画さん");
  const a = MK.projects.resolveOrCreate("PJ-A"), b = MK.projects.resolveOrCreate("PJ-B");
  W.addAllocation({ memberId: mid, targetId: a, percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" });
  W.addAllocation({ memberId: mid, targetId: b, percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" });
  eq(W.allocations().length, 2);
  eq(W.allocationsOf(mid).length, 2);
  eq(W.allocationsForTarget(a).length, 1);
  eq(W.allocationsForTarget(a)[0].percent, 60);
});

test("workload/alloc: 期間内の全器割当を合算する純関数", (MK) => {
  // 観点: 「空き要員 = 総キャパ − 全器へのアロケーション合計」の集計元となる純関数（#27 用）
  // 入力: PJ-A 60% / PJ-B 30%（いずれも6月）と、範囲外の PJ-C 40%（7月）
  // 期待: 6/15 時点の合計は90%（範囲外は含めない）、範囲外日は0%
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("集計さん");
  const list = [
    { memberId: mid, targetId: "a", percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: mid, targetId: "b", percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: mid, targetId: "c", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "other", targetId: "a", percent: 99, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  eq(W.allocationPercentOn(list, mid, "2026-06-15"), 90);
  eq(W.allocationPercentOn(list, mid, "2026-07-15"), 40);
  eq(W.allocationPercentOn(list, mid, "2026-05-15"), 0);
});

test("workload/alloc: アロケーションはタスク（負荷）と独立で相互不干渉", (MK) => {
  // 観点: 計画（アロケーション）と実行（タスク=負荷）は別レコード。片方を変えても他方に影響しない（§3.7.5）
  // 入力: メンバーにタスク1件（負荷40）とアロケーション1件（80%）を持たせ、タスクを削除
  // 期待: タスク削除後もアロケーションは残り、負荷系列はアロケーションの影響を受けない
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("独立さん");
  const mon = MK.util.mondayOf("2026-06-01");
  W.addTask({ memberId: mid, title: "t", load: 40, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  W.addAllocation({ memberId: mid, targetId: "a", percent: 80, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  almost(W.series(mid, [mon])[0], 40); // アロケーション80%は負荷に混ざらない
  const tid = W.tasksOf(mid)[0].id;
  W.removeTask(tid);
  eq(W.tasksOf(mid).length, 0);
  eq(W.allocationsOf(mid).length, 1); // タスク削除はアロケーションに影響しない
});

test("workload/alloc: 既存データ（allocations 欠落）でも読めて失われない移行", (MK) => {
  // 観点: allocations フィールドを持たない旧 workload データの移行（load 時に補完・非破壊）
  // 入力: allocations キーの無い旧形状を直接 store へ書き、load → アロケーション追加
  // 期待: load で allocations=[] が補完され、既存 tasks は保持、追加も保存される
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("旧データさん");
  MK.store.write("module:workload", { version: 1, tasks: [{ id: "wt1", memberId: mid, title: "旧", load: 30, startDate: "", endDate: "", status: "todo", completedDate: null, note: "" }], baseline: null, memberSettings: {} });
  eq(W.allocations().length, 0);       // 欠落は空配列に補完される
  eq(W.tasks().length, 1);             // 既存タスクは失われない
  W.addAllocation({ memberId: mid, targetId: "a", percent: 50, startDate: "2026-06-01", endDate: "2026-06-30" });
  eq(W.allocations().length, 1);
});
