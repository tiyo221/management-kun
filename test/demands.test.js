/* demands（需要）共有マスタ — CRUD と集計純関数（Issue #68 / #52 Phase 2） */
"use strict";

test("demands: create/get/update/remove の基本 CRUD", (MK) => {
  // 観点: people/projects/allocations と同格の共有マスタとして CRUD できる
  // 入力: 1件作成 → 取得 → 更新 → 削除
  // 期待: 各操作が反映され、削除後は取得不可
  const D = MK.demands;
  const x = D.create({ targetId: "a", startDate: "2026-07-01", endDate: "2026-07-31", requiredPercent: 150 });
  assert(x.id && x.id.indexOf("d") === 0, "id は d プレフィックス");
  eq(D.get(x.id).requiredPercent, 150);
  D.update(x.id, { requiredPercent: 80 });
  eq(D.get(x.id).requiredPercent, 80);
  D.remove(x.id);
  eq(D.get(x.id), null);
});

test("demands: create の既定値と replaceAll", (MK) => {
  // 観点: 未指定フィールドは既定で補完され、replaceAll で全置換できる
  // 入力: 属性なしで create → replaceAll で2件へ置換
  // 期待: 既定 dim=project・requiredPercent=100、置換後は2件
  const D = MK.demands;
  const x = D.create({});
  eq(x.dim, "project");
  eq(x.requiredPercent, 100);
  D.replaceAll([
    { id: "d1", targetId: "a", startDate: "2026-07-01", endDate: "2026-07-31", requiredPercent: 100 },
    { id: "d2", targetId: "b", startDate: "2026-07-01", endDate: "2026-07-31", requiredPercent: 50 },
  ]);
  eq(D.all().length, 2);
});

test("demands: demandOn は器×期間で必要%を合算し、範囲外は0", (MK) => {
  // 観点: 同一器に期間の重なる複数需要は合算、他器・範囲外は混ぜない
  // 入力: a に 100% と 50%（重なる期間）、b に 200%
  // 期待: a=150、b=200、範囲外日は0
  const D = MK.demands;
  const list = [
    { targetId: "a", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "a", requiredPercent: 50, startDate: "2026-07-10", endDate: "2026-07-20" },
    { targetId: "b", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  eq(D.demandOn(list, "a", "2026-07-15"), 150);
  eq(D.demandOn(list, "b", "2026-07-15"), 200);
  eq(D.demandOn(list, "a", "2026-06-15"), 0);
});

test("demands: totalDemandOn は全器合計の必要%（期間内のみ）", (MK) => {
  // 観点: チーム総需要の集計元。器を跨いで合算する
  // 入力: a 150% / b 200%（7月）、範囲外 c 300%（8月）
  // 期待: 7/15 は 350%、8/15 は c のみ 300%
  const D = MK.demands;
  const list = [
    { targetId: "a", requiredPercent: 150, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "b", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "c", requiredPercent: 300, startDate: "2026-08-01", endDate: "2026-08-31" },
  ];
  eq(D.totalDemandOn(list, "2026-07-15"), 350);
  eq(D.totalDemandOn(list, "2026-08-15"), 300);
});
