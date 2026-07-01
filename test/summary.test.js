/* HOME サマリー契約（spec §3.6）— 各モジュール logic.summary() の形と空状態 */
"use strict";

// 契約: { empty: boolean, stats: [{label, value}] }。空データでも破綻しない（empty=true）。
function assertShape(s) {
  assert(s && typeof s.empty === "boolean", "empty は boolean");
  assert(Array.isArray(s.stats) && s.stats.length > 0, "stats は非空配列");
  s.stats.forEach((x) => assert(typeof x.label === "string" && x.value != null, "各 stat は label/value を持つ"));
}

test("summary: todo は空→empty、追加後は未完/全タスク", (MK) => {
  const T = MK.logic.todo;
  assertShape(T.summary());
  assert(T.summary().empty, "空なら empty=true");
  T.addTask("a"); T.addTask("b");
  const s = T.summary();
  assert(!s.empty);
  eq(s.stats[0].value, 2); // 未完
  eq(s.stats[1].value, 2); // 全タスク
});

test("summary: goals は空→empty、追加後は達成率0%", (MK) => {
  const G = MK.logic.goals;
  assertShape(G.summary());
  assert(G.summary().empty);
  G.addGoal("目標X");
  const s = G.summary();
  assert(!s.empty);
  eq(s.stats[0].value, "0%");
  eq(s.stats[1].value, 1);
});

test("summary: skills は人もスキルも無ければ empty", (MK) => {
  const S = MK.logic.skills;
  assertShape(S.summary());
  assert(S.summary().empty);
  MK.people.resolveOrCreate("誰か");
  const s = S.summary();
  assert(!s.empty);
  eq(s.stats[0].value, 1); // メンバー
});

test("summary: wbs は葉タスクが無ければ empty", (MK) => {
  const W = MK.logic.wbs;
  assertShape(W.summary());
  assert(W.summary().empty);
  W.addRoot();
  const s = W.summary();
  assert(!s.empty);
  eq(s.stats[1].value, "0%"); // 進捗
});

test("summary: workload はタスクが無ければ empty", (MK) => {
  const L = MK.logic.workload;
  assertShape(L.summary());
  assert(L.summary().empty);
  const mid = MK.people.resolveOrCreate("担当");
  const mon = MK.util.mondayOf(MK.util.todayISO());
  L.addTask({ memberId: mid, title: "x", load: 40, startDate: mon, endDate: MK.util.addDays(mon, 6), status: "in_progress" });
  const s = L.summary();
  assert(!s.empty);
  assert(/%$/.test(String(s.stats[0].value)), "平均稼働は % 表記");
});
