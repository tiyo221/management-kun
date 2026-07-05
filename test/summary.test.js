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

// ---- attention（要対応帯。Issue #102）----
// 契約: attention は任意の配列。各要素は { label: string, severity: "error"|"warn"|"info" }。
// 要対応が無ければ空配列（帯に出ない）。「今日」依存の集計は基準日を引数で固定する（決定的テスト）。

test("attention: todo は期限切れ=error / 今日期限=warn を申告する（done・期限なしは対象外）", (MK) => {
  // 観点: dueCounts の分類（過去/今日/未来/完了）と attention への変換
  // 入力: 基準日 2026-07-05。期限切れ1・今日期限1・未来1・完了済み期限切れ1・期限なし1
  // 期待: attention は [error(期限切れ1件), warn(今日期限1件)] の順。dueCounts も一致
  const T = MK.logic.todo;
  const today = "2026-07-05";
  eq(T.summary(today).attention.length, 0, "空なら申告なし");
  T.addTask("期限なし"); T.addTask("未来"); T.addTask("完了済み"); T.addTask("今日"); T.addTask("過去");
  const ids = {}; T.tasks().forEach((t) => { ids[t.title] = t.id; });
  T.updateTask(ids["過去"], { due: "2026-07-01" });
  T.updateTask(ids["今日"], { due: today });
  T.updateTask(ids["完了済み"], { due: "2026-07-01", status: "done" });
  T.updateTask(ids["未来"], { due: "2026-07-10" });
  const dc = T.dueCounts(today);
  eq(dc.overdue, 1); eq(dc.dueToday, 1);
  const att = T.summary(today).attention;
  eq(att.length, 2);
  eq(att[0].severity, "error"); assert(att[0].label.includes("期限切れ 1件"), "期限切れの件数を含む");
  eq(att[1].severity, "warn"); assert(att[1].label.includes("今日期限 1件"), "今日期限の件数を含む");
});

test("attention: techstack は見直し期限の超過=error / 接近=warn を申告する", (MK) => {
  // 観点: deadlineCounts（超過/90日以内）が attention に変換されること
  // 入力: 基準日 2026-07-05。超過1・接近(30日後)1・余裕(200日後)1・期限なし1
  // 期待: attention は [error(超過1件), warn(接近1件)]。期限なし・余裕は出ない
  const T = MK.logic.techstack;
  const today = "2026-07-05";
  eq(T.summary(today).attention.length, 0, "空なら申告なし");
  T.addItem("超過");   T.updateItem(T.items()[0].id, { reviewDate: "2026-07-01" });
  T.addItem("接近");   T.updateItem(T.items()[0].id, { reviewDate: "2026-08-04" });
  T.addItem("余裕");   T.updateItem(T.items()[0].id, { reviewDate: "2027-01-21" });
  T.addItem("期限なし");
  const att = T.summary(today).attention;
  eq(att.length, 2);
  eq(att[0].severity, "error"); assert(att[0].label.includes("超過 1件"));
  eq(att[1].severity, "warn"); assert(att[1].label.includes("1件"));
});

test("attention: questions は未解決があるときだけ info を申告する", (MK) => {
  // 観点: 未解決（open）件数の attention 変換と、全解決時の非申告
  // 入力: 未解決2件 → うち1件を resolved に更新 → 残り1件も resolved
  // 期待: 2件時 info「2件」、全解決後は空配列
  const Q = MK.logic.questions;
  eq(Q.summary().attention.length, 0, "空なら申告なし");
  Q.addItem("q1"); Q.addItem("q2");
  let att = Q.summary().attention;
  eq(att.length, 1);
  eq(att[0].severity, "info"); assert(att[0].label.includes("2件"));
  Q.items().forEach((it) => Q.updateItem(it.id, { status: "resolved" }));
  eq(Q.summary().attention.length, 0, "全解決なら申告なし");
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
