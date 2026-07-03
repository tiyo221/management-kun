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

test("workload: 昇格前バックアップ（workload 内 allocations）の取込は共有マスタへ転送する", (MK) => {
  // 観点: Issue #45 以前に書き出したバックアップは allocations を workload 内に持つ。
  //       取込時に失わず共有マスタへ加算的に移す（既存 id は上書きしない・非破壊）
  // 入力: マスタに wa9(10%) を先に置き、workload 内 allocations を含む旧形状を replace 取込
  // 期待: 新規 wa1 はマスタへ転送、既存 wa9 は上書きされず、workload 側には allocations が残らない
  const W = MK.logic.workload;
  MK.allocations.create({ id: "wa9", memberId: "m1", targetId: "a", percent: 10, startDate: "2026-06-01", endDate: "2026-06-30" });
  W.importData({ version: 1, tasks: [{ id: "wt1", memberId: "m1", title: "旧", load: 30, startDate: "", endDate: "", status: "todo", completedDate: null, note: "" }], allocations: [
    { id: "wa1", memberId: "m1", targetId: "a", dim: "project", startDate: "2026-06-01", endDate: "2026-06-30", percent: 60, note: "" },
    { id: "wa9", memberId: "m1", targetId: "a", dim: "project", startDate: "2026-06-01", endDate: "2026-06-30", percent: 99, note: "" },
  ] }, "replace");
  eq(MK.allocations.all().length, 2);       // wa1 追加・wa9 は据え置き
  eq(MK.allocations.get("wa1").percent, 60);
  eq(MK.allocations.get("wa9").percent, 10); // 既存は上書きしない
  eq(W.tasks().length, 1);
  assert(MK.store.read("module:workload").allocations === undefined, "workload 側に allocations は残らない");
});
