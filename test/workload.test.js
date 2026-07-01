/* workload ロジック（負荷計算・実効終了日） */
"use strict";

test("workload: 週次=日次負担の平均（均等割り）", (MK) => {
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("テスト太郎");
  const mon = MK.util.mondayOf("2026-06-01");
  // 月〜日の7日間、負担30 → 週次平均 30
  W.addTask({ memberId: mid, title: "x", load: 30, startDate: mon, endDate: MK.util.addDays(mon, 6), status: "in_progress" });
  almost(W.series(mid, [mon])[0], 30);
});

test("workload: 完了タスクは完了日を実効終了日にする", (MK) => {
  const W = MK.logic.workload;
  eq(W.effEnd({ status: "done", completedDate: "2026-01-05", endDate: "2026-01-10" }), "2026-01-05");
  eq(W.effEnd({ status: "in_progress", completedDate: null, endDate: "2026-01-10" }), "2026-01-10");
});

test("workload: 100超はクランプしない", (MK) => {
  const W = MK.logic.workload;
  const mid = MK.people.resolveOrCreate("多忙さん");
  const mon = MK.util.mondayOf("2026-06-01");
  W.addTask({ memberId: mid, title: "a", load: 80, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  W.addTask({ memberId: mid, title: "b", load: 50, startDate: mon, endDate: MK.util.addDays(mon, 6) });
  almost(W.series(mid, [mon])[0], 130);
});
