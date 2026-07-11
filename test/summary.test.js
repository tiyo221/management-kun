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

test("attention: wbs は期限超過タスクを error で申告する（未完かつ終了日<基準日・全PJ横断）", (MK) => {
  // 観点: 期限超過（isOverdue: 未完かつ終了日<基準日）を全PJ横断で数え attention(error) に昇格する
  // 入力: サンプル（親1＋葉4。t2 done・t3/t4/t5 未完で終了日は本日から2週間内）を投入
  // 期待: 過去基準日=申告なし / 遠い未来基準日=期限超過3件(error)。判定は葉のみ・done は対象外
  const W = MK.logic.wbs;
  assert(W.summary("2000-01-01").attention === undefined, "空/期限内なら申告なし");
  W.loadSample();
  eq(W.summary("2000-01-01").attention, undefined, "全タスクが未来なら申告なし");
  const att = W.summary("2099-01-01").attention;
  assert(Array.isArray(att) && att.length === 1, "attention 1件");
  eq(att[0].severity, "error");
  assert(att[0].label.includes("3件"), "期限超過の件数（葉・未完のみ）を含む: " + att[0].label);
});

test("attention: resource は過負荷を warn で申告する（誰が過負荷か分かるラベル・0人なら出さない）", (MK) => {
  // 観点: 過負荷（割当>1人分）を attention(warn) に昇格し、代表者名＋FTE を含むラベルにする
  // 入力: 基準日を含む期間で 佐藤=130%（過負荷）、田中=80%（正常）
  // 期待: 過負荷0人なら申告なし / 佐藤のみ過負荷なら warn「過負荷: 佐藤 (1.3人分)」
  const R = MK.logic.resource;
  const today = MK.util.todayISO();
  const span = { startDate: MK.util.addDays(today, -1), endDate: MK.util.addDays(today, 30) };
  const sato = MK.people.resolveOrCreate("佐藤"), tanaka = MK.people.resolveOrCreate("田中");
  MK.allocations.create(Object.assign({ memberId: tanaka, targetId: "a", percent: 80 }, span));
  assert(R.summary(today).attention === undefined, "過負荷0人なら申告なし");
  MK.allocations.create(Object.assign({ memberId: sato, targetId: "a", percent: 70 }, span));
  MK.allocations.create(Object.assign({ memberId: sato, targetId: "b", percent: 60 }, span));
  const att = R.summary(today).attention;
  assert(Array.isArray(att) && att.length === 1, "attention 1件");
  eq(att[0].severity, "warn");
  assert(att[0].label.includes("佐藤"), "誰が過負荷か（名前）を含む: " + att[0].label);
  assert(att[0].label.includes("1.3人"), "過負荷量（FTE）を含む: " + att[0].label);
});

test("attention: resource は複数人過負荷なら代表＋ほかN人に畳む", (MK) => {
  // 観点: 過負荷が複数人のときはバーが長くならないよう「代表 ほかN人」に畳む（代表＝最も過負荷な人）
  // 入力: 佐藤=200%、鈴木=150%（ともに過負荷）
  // 期待: warn「過負荷: 佐藤 ほか1人」（assigned 降順で佐藤が代表）
  const R = MK.logic.resource;
  const today = MK.util.todayISO();
  const span = { startDate: MK.util.addDays(today, -1), endDate: MK.util.addDays(today, 30) };
  const sato = MK.people.resolveOrCreate("佐藤"), suzuki = MK.people.resolveOrCreate("鈴木");
  MK.allocations.create(Object.assign({ memberId: sato, targetId: "a", percent: 200 }, span));
  MK.allocations.create(Object.assign({ memberId: suzuki, targetId: "a", percent: 150 }, span));
  const att = R.summary(today).attention;
  eq(att.length, 1);
  assert(att[0].label.includes("佐藤") && att[0].label.includes("ほか1人"), "代表＋ほかN人: " + att[0].label);
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
