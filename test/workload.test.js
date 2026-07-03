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

test("workload: アロケーション（計画）は負荷（タスク）と独立で相互不干渉", (MK) => {
  // 観点: 計画（共有マスタのアロケーション）と実行（タスク=負荷）は別レコード。片方を変えても他方に影響しない（§3.7.5）
  // 入力: メンバーにタスク1件（負荷40）とアロケーション1件（80%）を持たせ、タスクを削除
  // 期待: タスク削除後もアロケーションは共有マスタに残り、負荷系列はアロケーションの影響を受けない
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("独立さん");
  const mon = MK.util.mondayOf("2026-06-01");
  W.addTask({ memberId: mid, title: "t", load: 40, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  MK.allocations.create({ memberId: mid, targetId: "a", percent: 80, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  almost(W.series(mid, [mon])[0], 40); // アロケーション80%は負荷に混ざらない
  const tid = W.tasksOf(mid)[0].id;
  W.removeTask(tid);
  eq(W.tasksOf(mid).length, 0);
  eq(MK.allocations.of(mid).length, 1); // タスク削除はアロケーションに影響しない
});
