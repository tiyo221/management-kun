/* エンティティ単位の任意契約 summaryFor（spec §3.6.1）— 人・プロジェクト詳細の集約ビュー（#83）が
   消費する各モジュール logic.summaryFor("person", id) の集約ロジックを検証する。契約リーダ
   MK.readEntitySummary 自体は read-entity-summary.test.js が担い、ここは各モジュールの中身を担当する。
   契約: 戻り値は summary() と同型 { empty, stats:[{label,value}], attention? }。
     - entityType !== "person"（未対応種別）は該当データ無し（empty=true）で応える（"project" 決め打ち分岐なし）
     - 当該 person にデータが無ければ empty=true、あれば empty=false で集約値を返す */
"use strict";

function assertShape(s) {
  assert(s && typeof s.empty === "boolean", "empty は boolean");
  assert(Array.isArray(s.stats), "stats は配列");
  s.stats.forEach((x) => assert(typeof x.label === "string" && x.value != null, "各 stat は label/value を持つ"));
}

// ---- skills ----
test("summaryFor: skills は評価が無ければ empty、評価後は評価済み数・平均・コア充足", (MK) => {
  // 観点: 人のスキル評価概況（評価済みスキル数・平均レベル・コア充足）を集約する
  // 入力: コア(目標3)と非コアの2スキル、対象人に 4 と 2 を評価
  // 期待: 空は empty=true / 評価後 empty=false・評価済み2・平均3.0・コア充足1/1
  const S = MK.logic.skills;
  const p = MK.people.resolveOrCreate("対象");
  assert(S.summaryFor("person", p).empty, "評価なしは empty");
  assertShape(S.summaryFor("person", p));
  S.addSkill({ domain: "d", item: "core", core: true, targetLevel: 3 });
  S.addSkill({ domain: "d", item: "sub" });
  const [core, sub] = S.skills();
  S.setRating(p, core.id, "4");
  S.setRating(p, sub.id, "2");
  const s = S.summaryFor("person", p);
  assert(!s.empty);
  eq(s.stats[0].value, 2, "評価済みスキル数");
  eq(s.stats[1].value, "3.0", "平均レベル");
  eq(s.stats[2].value, "1/1", "コア充足（目標3以上のコア1件）");
});

test("summaryFor: skills は他人の評価に引きずられない／未対応種別は empty", (MK) => {
  // 観点: id で絞り込むこと、person 以外の entityType は該当なし（empty）で応える
  const S = MK.logic.skills;
  const me = MK.people.resolveOrCreate("自分");
  const other = MK.people.resolveOrCreate("他人");
  S.addSkill({ domain: "d", item: "x" });
  S.setRating(other, S.skills()[0].id, "5");
  assert(S.summaryFor("person", me).empty, "自分に評価が無ければ empty（他人の評価は無関係）");
  assert(S.summaryFor("project", me).empty, "person 以外は empty");
  eq(S.summaryFor("project", me).stats, []);
});

// ---- resource ----
test("summaryFor: resource は割当が無ければ empty、割当後は現在割当・稼働中PJ", (MK) => {
  // 観点: 本日時点のアサイン状況（現在の割当 FTE・稼働中PJ 件数）を集約する
  // 入力: 基準日を含む期間の割当を1件（60%）
  // 期待: 空は empty=true / 割当後 empty=false・現在の割当 "0.6人"・稼働中PJ "1件"
  const R = MK.logic.resource;
  const p = MK.people.resolveOrCreate("要員");
  const today = MK.util.todayISO();
  assert(R.summaryFor("person", p).empty, "割当なしは empty");
  assertShape(R.summaryFor("person", p));
  MK.allocations.create({ memberId: p, targetId: "pj1", startDate: MK.util.addDays(today, -1), endDate: MK.util.addDays(today, 30), percent: 60 });
  const s = R.summaryFor("person", p);
  assert(!s.empty);
  eq(s.stats[0].value, "0.6人", "現在の割当（FTE）");
  eq(s.stats[1].value, "1件", "稼働中PJ 件数");
  assert(!s.attention, "1人分以内なら attention なし");
});

test("summaryFor: resource は割当が1人分を超えると attention(warn) を申告する", (MK) => {
  // 観点: 過負担（合計 > 100%）を attention で申告する（要対応帯・詳細画面が拾う）
  // 入力: 同一人に 70% と 60% の重なる割当（合計 130%）
  // 期待: attention に warn 1件、割当は "1.3人"
  const R = MK.logic.resource;
  const p = MK.people.resolveOrCreate("過負担");
  const today = MK.util.todayISO();
  const span = { startDate: MK.util.addDays(today, -1), endDate: MK.util.addDays(today, 30) };
  MK.allocations.create(Object.assign({ memberId: p, targetId: "a", percent: 70 }, span));
  MK.allocations.create(Object.assign({ memberId: p, targetId: "b", percent: 60 }, span));
  const s = R.summaryFor("person", p);
  eq(s.stats[0].value, "1.3人");
  assert(Array.isArray(s.attention) && s.attention.length === 1, "attention 1件");
  eq(s.attention[0].severity, "warn");
});

test("summaryFor: resource の未対応種別は empty", (MK) => {
  // 観点: project 集約は dashboard(#78) の担当。resource の summaryFor は person 以外を empty で返す
  const R = MK.logic.resource;
  assert(R.summaryFor("project", "pj1").empty);
  eq(R.summaryFor("project", "pj1").stats, []);
});

// ---- oneonone ----
test("summaryFor: oneonone は記録が無ければ empty、記録後は記録数・最終実施・未完アクション", (MK) => {
  // 観点: 1on1 概況（記録数・最終実施日・未完アクション数）を集約する
  // 入力: 対象人に2日前と5日前の記録、うち1件に未完アクション
  // 期待: 空は empty=true / 記録後 記録数2・最終実施=より新しい日・未完1
  const O = MK.logic.oneonone;
  const p = MK.people.resolveOrCreate("メンバー");
  const recent = MK.util.addDays(MK.util.todayISO(), -2);
  const older = MK.util.addDays(MK.util.todayISO(), -5);
  assert(O.summaryFor("person", p).empty, "記録なしは empty");
  assertShape(O.summaryFor("person", p));
  O.addEntry({ memberId: p, date: older, body: "b1", actions: [{ text: "宿題", done: false }] });
  O.addEntry({ memberId: p, date: recent, body: "b2", actions: [] });
  const s = O.summaryFor("person", p);
  assert(!s.empty);
  eq(s.stats[0].value, 2, "記録数");
  eq(s.stats[1].value, recent, "最終実施は最新日");
  eq(s.stats[2].value, 1, "未完アクション数");
});

test("summaryFor: oneonone の未対応種別は empty、記録ゼロの最終実施は '-'", (MK) => {
  const O = MK.logic.oneonone;
  const p = MK.people.resolveOrCreate("空メンバー");
  const s = O.summaryFor("person", p);
  assert(s.empty);
  eq(s.stats[1].value, "-", "記録が無ければ最終実施は '-'");
  assert(O.summaryFor("product", p).empty, "person 以外は empty");
});

// ---- wbs ----
test("summaryFor: wbs は全PJ横断で担当タスク数・進行中・完了を返す／未担当は empty", (MK) => {
  // 観点: scoped な wbs を全 PJ 横断で走査し、集計行の親を除いた葉タスクを担当として数える
  // 入力: PJ1（親＋葉3件）・PJ2（葉1件）に me/別人を割当
  // 期待: me の担当は親除外・全PJで a1/a2/b1 の3件、進行中1・完了1。未対応種別は empty
  const W = MK.logic.wbs;
  const me = MK.people.resolveOrCreate("担当者");
  const other = MK.people.resolveOrCreate("別人");
  assert(W.summaryFor("person", me).empty, "担当なしは empty");
  assertShape(W.summaryFor("person", me));
  const a = MK.projects.create({ name: "PJ1" });
  const b = MK.projects.create({ name: "PJ2" });
  W.importData({ version: 1, uid: 9, tasks: [
    { id: 1, level: 0, name: "親", assigneeId: me, status: "inprogress", deps: [] }, // 親（集計行）→ 除外
    { id: 2, level: 1, name: "a1", assigneeId: me, status: "inprogress", deps: [] },
    { id: 3, level: 1, name: "a2", assigneeId: me, status: "done", deps: [] },
    { id: 4, level: 1, name: "a3", assigneeId: other, status: "inprogress", deps: [] },
  ] }, "replace", a.id);
  W.importData({ version: 1, uid: 2, tasks: [
    { id: 1, level: 0, name: "b1", assigneeId: me, status: "notstarted", deps: [] },
  ] }, "replace", b.id);
  const s = W.summaryFor("person", me);
  assert(!s.empty);
  eq(s.stats[0].value, 3, "担当タスク（親除外・全PJ: a1,a2,b1）");
  eq(s.stats[1].value, 1, "進行中（a1）");
  eq(s.stats[2].value, 1, "完了（a2）");
  assert(W.summaryFor("project", a.id).empty, "person 以外の種別は empty");
});
