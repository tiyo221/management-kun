/* HOME サマリー契約（spec §3.6）— 各モジュール logic.summary() の形と空状態 */
"use strict";

// 契約: summary() は { empty: boolean, stats: [{label, value}] } を返す。
// 空データでも破綻せず empty=true になること、stats は必ず非空で各要素が label/value を持つことを担保する。
function assertShape(s) {
  assert(s && typeof s.empty === "boolean", "empty は boolean");
  assert(Array.isArray(s.stats) && s.stats.length > 0, "stats は非空配列");
  s.stats.forEach((x) => assert(typeof x.label === "string" && x.value != null, "各 stat は label/value を持つ"));
}

test("summary: todo は空→empty、追加後は未完/全タスク", (MK) => {
  // 観点: todo の summary は契約形を満たし、空なら empty=true、データ投入後は集計値を返す
  // 入力: 空の状態を確認 → タスク2件追加
  // 期待: 空は empty=true / 追加後 empty=false・stats[0]=未完2・stats[1]=全2
  const T = MK.logic.todo;
  assertShape(T.summary());
  assert(T.summary().empty, "空なら empty=true");
  T.addTask("a"); T.addTask("b");
  const s = T.summary();
  assert(!s.empty);
  eq(s.stats[0].value, 2);
  eq(s.stats[1].value, 2);
});

test("summary: goals は空→empty、追加後は達成率0%", (MK) => {
  // 観点: goals の summary は契約形を満たし、目標追加直後は達成率0%・目標数を返す
  // 入力: 空を確認 → 目標1件追加（ステップなし＝未達成）
  // 期待: 空は empty=true / 追加後 stats[0]="0%"・stats[1]=1
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
  // 観点: skills の summary は人もスキルも無ければ empty、人が居れば非空でメンバー数を返す
  // 入力: 空を確認 → 人を1人だけ登録（スキルは無し）
  // 期待: 空は empty=true / 人追加後 empty=false・stats[0]=メンバー1
  const S = MK.logic.skills;
  assertShape(S.summary());
  assert(S.summary().empty);
  MK.people.resolveOrCreate("誰か");
  const s = S.summary();
  assert(!s.empty);
  eq(s.stats[0].value, 1);
});

test("summary: wbs は葉タスクが無ければ empty", (MK) => {
  // 観点: wbs の summary は葉タスクが無ければ empty（親のみでは非空にしない）、追加後は進捗を返す
  // 入力: 空を確認 → addRoot() でルート1件追加
  // 期待: 空は empty=true / 追加後 empty=false・stats[1]=進捗 "0%"
  const W = MK.logic.wbs;
  assertShape(W.summary());
  assert(W.summary().empty);
  W.addRoot();
  const s = W.summary();
  assert(!s.empty);
  eq(s.stats[1].value, "0%");
});

test("summary: workload はタスクが無ければ empty", (MK) => {
  // 観点: workload の summary はタスクが無ければ empty、投入後は平均稼働を % 表記で返す
  // 入力: 空を確認 → 担当者1名に今週(月〜日)の負担40のタスクを1件
  // 期待: 空は empty=true / 追加後 empty=false・stats[0] が "…%" 形式
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
