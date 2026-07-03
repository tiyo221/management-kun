/* allocations（共有アロケーションマスタ）— CRUD・集計純関数・workload からの昇格移行（Issue #45） */
"use strict";

test("allocations: 1人を複数PJへ期間×割当%で保持し、器別・メンバー別に引ける", (MK) => {
  // 観点: 共有マスタ（人×器×期間×%）を複数器へ保持できる（§3.7.5 受け入れ条件）
  // 入力: 同一メンバーを PJ-A に60%、PJ-B に30%で追加
  // 期待: all に2件保持され、of / forTarget の絞り込みが引ける
  const A = MK.allocations;
  const mid = MK.people.resolveOrCreate("計画さん");
  const a = MK.projects.resolveOrCreate("PJ-A"), b = MK.projects.resolveOrCreate("PJ-B");
  A.create({ memberId: mid, targetId: a, percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" });
  A.create({ memberId: mid, targetId: b, percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" });
  eq(A.all().length, 2);
  eq(A.of(mid).length, 2);
  eq(A.forTarget(a).length, 1);
  eq(A.forTarget(a)[0].percent, 60);
});

test("allocations: update / remove が反映される", (MK) => {
  // 観点: マスタの基本 CRUD（People/Projects と同格）
  // 入力: 1件作成 → 割当を更新 → 削除
  // 期待: 更新後は 75%、削除後は 0 件
  const A = MK.allocations;
  const one = A.create({ memberId: "m1", targetId: "a", percent: 50, startDate: "2026-06-01", endDate: "2026-06-30" });
  A.update(one.id, { percent: 75 });
  eq(A.get(one.id).percent, 75);
  A.remove(one.id);
  eq(A.all().length, 0);
});

test("allocations: percentOn は期間内の全器割当を合算する純関数", (MK) => {
  // 観点: 「空き要員 = 総キャパ − 全器へのアロケーション合計」の集計元となる純関数（staffing が再利用）
  // 入力: PJ-A 60% / PJ-B 30%（いずれも6月）と、範囲外の PJ-C 40%（7月）、他人の割当
  // 期待: 6/15 時点の合計は90%（範囲外・他人は含めない）、範囲外日は0%
  const A = MK.allocations;
  const list = [
    { memberId: "m", targetId: "a", percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m", targetId: "b", percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m", targetId: "c", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "other", targetId: "a", percent: 99, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  eq(A.percentOn(list, "m", "2026-06-15"), 90);
  eq(A.percentOn(list, "m", "2026-07-15"), 40);
  eq(A.percentOn(list, "m", "2026-05-15"), 0);
});

test("allocations: migrateFromWorkload は旧 workload 内部のアロケーションを移設する（加算的・冪等）", (MK) => {
  // 観点: Issue #45 の昇格移行。旧 workload 内部データを共有マスタへ移し、workload からは除去する
  // 入力: workload 名前空間に allocations を含む旧形状を直接書き込む
  // 期待: 移設後は共有マスタに2件、workload からは allocations が消え、再実行は0件（冪等）
  const A = MK.allocations;
  MK.store.write("module:workload", { version: 1, tasks: [{ id: "wt1", memberId: "m1", title: "旧", load: 30, startDate: "", endDate: "", status: "todo", completedDate: null, note: "" }], allocations: [
    { id: "wa1", memberId: "m1", targetId: "a", dim: "project", startDate: "2026-06-01", endDate: "2026-06-30", percent: 60, note: "" },
    { id: "wa2", memberId: "m1", targetId: "b", dim: "project", startDate: "2026-06-01", endDate: "2026-06-30", percent: 30, note: "" },
  ], baseline: null, memberSettings: {} });
  const moved = A.migrateFromWorkload();
  eq(moved, 2);
  eq(A.all().length, 2);
  eq(A.get("wa1").percent, 60);          // 旧 id を保持したまま移設
  eq(MK.logic.workload.tasks().length, 1); // タスクは失われない
  assert(MK.store.read("module:workload").allocations === undefined, "workload から allocations が除去される");
  eq(A.migrateFromWorkload(), 0);        // 冪等: 2回目は移設なし
});

test("allocations: migrateFromWorkload は既存 id を上書きしない", (MK) => {
  // 観点: 加算的・非破壊。既にマスタにある id は移行で上書きしない
  // 入力: マスタに wa1（percent=10）を先に作り、workload 側に同 id（percent=99）
  // 期待: マスタの wa1 は 10 のまま、移設件数は0
  const A = MK.allocations;
  A.create({ id: "wa1", memberId: "m1", targetId: "a", percent: 10, startDate: "2026-06-01", endDate: "2026-06-30" });
  MK.store.write("module:workload", { version: 1, tasks: [], allocations: [
    { id: "wa1", memberId: "m1", targetId: "a", dim: "project", startDate: "2026-06-01", endDate: "2026-06-30", percent: 99, note: "" },
  ], baseline: null, memberSettings: {} });
  eq(A.migrateFromWorkload(), 0);
  eq(A.get("wa1").percent, 10);
});
