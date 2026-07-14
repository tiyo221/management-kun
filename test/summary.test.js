/* HOME サマリー契約（spec §3.6）— 各モジュール logic.summary() の形と空状態 */
"use strict";

// 契約: summary() は { empty: boolean, stats: [{label, value}] } を返す。
// 空データでも破綻せず empty=true になること、stats は必ず非空で各要素が label/value を持つことを担保する。
function assertShape(s) {
  assert(s && typeof s.empty === "boolean", "empty は boolean");
  assert(Array.isArray(s.stats) && s.stats.length > 0, "stats は非空配列");
  s.stats.forEach((x) => assert(typeof x.label === "string" && x.value != null, "各 stat は label/value を持つ"));
}

test("summary: todo は空→empty、追加後は未完/期日未設定", (MK) => {
  // 観点: todo の summary は契約形を満たし、空なら empty=true、データ投入後は行動指標を返す
  // 入力: 空の状態を確認 → タスク2件追加（期日なし）→ 1件に期日を設定
  // 期待: 空は empty=true / 追加後 未完2・期日未設定2 → 期日設定後 未完2・期日未設定1（母数は出さない）
  const T = MK.logic.todo;
  assertShape(T.summary());
  assert(T.summary().empty, "空なら empty=true");
  T.addTask("a"); T.addTask("b");
  let s = T.summary();
  assert(!s.empty);
  eq(s.stats[0].label, "未完"); eq(s.stats[0].value, 2);
  eq(s.stats[1].label, "期日未設定"); eq(s.stats[1].value, 2);
  T.updateTask(T.tasks()[0].id, { due: "2026-07-20" });
  s = T.summary();
  eq(s.stats[0].value, 2, "未完は変わらず2");
  eq(s.stats[1].value, 1, "期日を設定した1件が減る");
});

test("summary: goals は空→empty、追加後は達成率0%・未着手", (MK) => {
  // 観点: goals の summary は契約形を満たし、目標追加直後は達成率0%・未着手（母数は出さない）
  // 入力: 空を確認 → 目標1件追加（ステップなし＝未達成・未着手）→ ステップ着手で未着手が減る
  // 期待: 空は empty=true / 追加後 stats[0]="0%"・stats[1]=未着手1 → ステップ完了後 未着手0
  const G = MK.logic.goals;
  assertShape(G.summary());
  assert(G.summary().empty);
  G.addGoal("目標X");
  let s = G.summary();
  assert(!s.empty);
  eq(s.stats[0].label, "達成率"); eq(s.stats[0].value, "0%");
  eq(s.stats[1].label, "未着手"); eq(s.stats[1].value, 1);
  const g = G.goals()[0];
  G.addStep(g.id, "一歩目"); G.toggleStep(g.id, G.getGoal(g.id).steps[0].id, true);
  eq(G.summary().stats[1].value, 0, "1ステップでも着手すれば未着手から外れる");
});

test("attention: goals は未達成かつ期限超過を warn で申告する（達成済みは対象外）", (MK) => {
  // 観点: 期限超過（未達成かつ deadline<基準日）を attention(warn) に昇格し、母数と重複させない
  // 入力: 基準日 2026-07-05。期限超過の未達成1・達成済み(期限超過)1・期限未来1・期限なし1
  // 期待: 期限超過1件のみ warn。達成済み・未来・期限なしは出さない
  const G = MK.logic.goals;
  const today = "2026-07-05";
  eq(G.summary(today).attention.length, 0, "空なら申告なし");
  const setDeadline = (title, dl) => { const id = G.addGoal(title); if (dl) G.updateGoal(id, { deadline: dl }); return id; };
  setDeadline("超過未達成", "2026-07-01");
  const doneId = setDeadline("達成済み", "2026-07-01");
  setDeadline("未来", "2026-07-10");
  setDeadline("期限なし", null);
  G.addStep(doneId, "s"); G.toggleStep(doneId, G.getGoal(doneId).steps[0].id, true);
  const att = G.summary(today).attention;
  eq(att.length, 1);
  eq(att[0].severity, "warn");
  assert(att[0].label.includes("1件"), "期限超過の件数を含む: " + att[0].label);
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

test("summary: techstack は空→empty、追加後は保留（Hold）/評価中（母数は出さない）", (MK) => {
  // 観点: techstack の summary は契約形を満たし、行動指標（判断待ちの保留・採否判断の評価中）を返す
  // 入力: 空を確認 → hold1・assess1・trial1・adopt1 を投入
  // 期待: 空は empty=true / 投入後 保留（Hold）=1・評価中=2（assess+trial）。技術総数・期限 stat は出さない
  const T = MK.logic.techstack;
  assertShape(T.summary());
  assert(T.summary().empty, "空なら empty=true");
  T.addItem("保留A");  T.updateItem(T.items()[0].id, { ring: "hold" });
  T.addItem("評価A");  T.updateItem(T.items()[0].id, { ring: "assess" });
  T.addItem("試行A");  T.updateItem(T.items()[0].id, { ring: "trial" });
  T.addItem("採用A");  T.updateItem(T.items()[0].id, { ring: "adopt" });
  const s = T.summary();
  assert(!s.empty);
  eq(s.stats.length, 2, "stats は2件（母数・期限 stat は撤去）");
  eq(s.stats[0].label, "保留（Hold）"); eq(s.stats[0].value, 1);
  eq(s.stats[1].label, "評価中"); eq(s.stats[1].value, 2);
  s.stats.forEach((x) => assert(x.label !== "技術" && !x.label.includes("期限"), "母数・期限 stat は出さない"));
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

test("summary/attention: releases は直近予定（＋あと何日）/日程未定 stat と 遅延 attention（母数なし・重複なし）", (MK) => {
  // 観点: releases の summary は契約形を満たし、行動指標（直近予定・日程未定）＋ attention（遅延・warn）を返す
  // 入力: 基準日 2026-01-10。完了1・未来 planned1（あと14日）・日程未定 planned1・遅延（過去 planned）1
  // 期待: 空は empty=true。stats=直近予定/日程未定（母数 予定 は出さない）、遅延は attention のみ（stats に重複させない）
  const R = MK.logic.releases;
  const base = "2026-01-10";
  assertShape(R.summary(base));
  assert(R.summary(base).empty, "空なら empty=true");
  const p = MK.products.create({ name: "P" });
  R.addRelease({ productId: p.id, version: "done1", plannedDate: "2026-01-01", actualDate: "2026-01-01", status: "done" });
  R.addRelease({ productId: p.id, version: "next", plannedDate: "2026-01-24" });
  R.addRelease({ productId: p.id, version: "tbd", plannedDate: "" });
  R.addRelease({ productId: p.id, version: "late", plannedDate: "2026-01-05" });
  const s = R.summary(base);
  assert(!s.empty);
  eq(s.stats.length, 2, "stats は2件（母数 予定 は撤去）");
  eq(s.stats[0].label, "直近予定"); eq(s.stats[0].value, "2026-01-24（あと14日）");
  eq(s.stats[1].label, "日程未定"); eq(s.stats[1].value, 1);
  s.stats.forEach((x) => assert(x.label !== "予定" && x.label !== "遅延", "母数・遅延 stat は出さない（重複回避）"));
  eq(s.attention.length, 1);
  eq(s.attention[0].label, "遅延 1件"); eq(s.attention[0].severity, "warn");
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

test("attention: wbs は全PJ横断で期限超過を集計し、進行中/進捗ともスコープを揃える（#181 レビュー指摘）", (MK) => {
  // 観点: PJ が複数あるとき summary は全 PJ 横断で集計する（stats の単一 store と食い違わせない）
  // 入力: project 次元で PJ-A（期限超過1・進行中1）と PJ-B（期限超過1・進行中0）を投入
  // 期待: 遠い未来基準日で期限超過=2件(error)、進行中=2（A の inprogress ＋ B の inprogress）
  const prev = global.window.MK_CONFIG;
  global.window.MK_CONFIG = { dimensions: [{ dim: "project", label: "プロジェクト", master: "projects" }] };
  try {
    const W = MK.logic.wbs;
    const a = MK.projects.create({ name: "PJ-A" });
    const b = MK.projects.create({ name: "PJ-B" });
    W.importData({ version: 1, uid: 3, tasks: [
      { id: 1, level: 0, name: "A遅延", status: "inprogress", end: "2026-07-01", deps: [] },
      { id: 2, level: 0, name: "A進行中期限内", status: "inprogress", end: "2099-01-01", deps: [] },
    ] }, "replace", a.id);
    W.importData({ version: 1, uid: 2, tasks: [
      { id: 1, level: 0, name: "B遅延", status: "notstarted", end: "2026-07-01", deps: [] },
    ] }, "replace", b.id);
    const s = W.summary("2026-07-12");
    eq(s.stats[0].value, 2, "進行中は全PJ横断（A の2件）");
    assert(Array.isArray(s.attention) && s.attention.length === 1, "attention 1件");
    eq(s.attention[0].severity, "error");
    assert(s.attention[0].label.includes("2件"), "全PJ横断で期限超過2件: " + s.attention[0].label);
  } finally { global.window.MK_CONFIG = prev; }
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

test("summary: questions は未解決を stats に出し、母数・throughput は出さない", (MK) => {
  // 観点: stats は未解決（バックログ）のみ。今週わかった等の throughput 系は撤去
  // 入力: 未解決1・解決済み1
  // 期待: stats は1要素（未解決）で value=1
  const Q = MK.logic.questions;
  Q.addItem("q1"); Q.addItem("q2");
  Q.updateItem(Q.items()[0].id, { status: "resolved" });
  const s = Q.summary();
  eq(s.stats.length, 1);
  eq(s.stats[0].label, "未解決");
  eq(s.stats[0].value, 1);
});

test("attention: questions は停滞（14日以上未解決）を warn で申告する", (MK) => {
  // 観点: 未解決かつ最終更新から STALE_DAYS(14) 日以上のものを stale として attention(warn) に昇格
  // 入力: 基準日 2026-07-14。20日前更新の未解決1・5日前更新の未解決1・20日前更新だが解決済み1
  // 期待: 停滞1件のみ warn。新しい未解決・解決済みは対象外
  const Q = MK.logic.questions;
  const today = "2026-07-14";
  eq(Q.summary(today).attention.length, 0, "空なら申告なし");
  // updateItem は updatedAt を現在時刻で上書きするため、任意日時は importData で直接投入する
  const q = (title, status, updatedAt) => ({ id: MK.util.uid("q"), title, detail: "", status, tags: [], resolvedNote: "", createdAt: updatedAt, updatedAt, resolvedAt: status === "resolved" ? updatedAt : null });
  Q.importData({ version: 1, items: [
    q("古い未解決", "open", "2026-06-24T09:00:00.000Z"),
    q("新しい未解決", "open", "2026-07-09T09:00:00.000Z"),
    q("古い解決済み", "resolved", "2026-06-24T09:00:00.000Z"),
  ] }, "replace");
  eq(Q.staleCount(today), 1);
  const att = Q.summary(today).attention;
  eq(att.length, 1);
  eq(att[0].severity, "warn"); assert(att[0].label.includes("停滞") && att[0].label.includes("1件"));
});
