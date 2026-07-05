/* dashboard（プロジェクト・ダッシュボード＝横断集約ビュー）の集約ロジック spec §9.2 / Issue #78 */
"use strict";

// wbs は対象別 namespace（§3.7.4）。dashboard.wbsSummary は wbs.exportData(projectId) を読むだけで
// scope の解決は要らないが、テストデータ投入のため importData を直に使う（DOM 不要）。
function seedWbs(MK, projectId, tasks) {
  MK.logic.wbs.importData({ version: 1, uid: 999, tasks }, "replace", projectId);
}

test("dashboard.projectStatusLabel: ステータスキーを日本語ラベルへ・未知値はそのまま", (MK) => {
  // 観点: マスタのステータスキーを表示ラベルへ変換し、未知値でも壊れない
  // 入力: active / archived / 未知 / 空
  // 期待: 進行中 / アーカイブ / そのまま / 空文字
  const D = MK.logic.dashboard;
  eq(D.projectStatusLabel("active"), "進行中");
  eq(D.projectStatusLabel("archived"), "アーカイブ");
  eq(D.projectStatusLabel("unknown"), "unknown");
  eq(D.projectStatusLabel(""), "");
});

test("dashboard.wbsSummary: タスクが無ければ empty、葉タスクから進捗・完了率を集計する", (MK) => {
  // 観点: WBS 進捗サマリは葉タスクを母数にし、親ロールアップ行は数えない（wbs.stats と同じ定義）
  // 入力: 親1 + 葉3（完了100 / 進行中50 / 未着手0）
  // 期待: 空は empty=true / 投入後 leaves=3・done=1・inprogress=1・overall=50%
  const D = MK.logic.dashboard;
  const p = MK.projects.create({ name: "PJ-X" });
  eq(D.wbsSummary(p.id, "2026-07-06").empty, true, "空なら empty=true");
  seedWbs(MK, p.id, [
    { id: 1, level: 0, name: "親", status: "inprogress", progress: 0, end: "", deps: [] },
    { id: 2, level: 1, name: "完了", status: "done", progress: 100, end: "2026-07-01", deps: [] },
    { id: 3, level: 1, name: "進行中", status: "inprogress", progress: 50, end: "2026-12-01", deps: [] },
    { id: 4, level: 1, name: "未着手", status: "notstarted", progress: 0, end: "2026-12-01", deps: [] },
  ]);
  const s = D.wbsSummary(p.id, "2026-07-06");
  eq(s.empty, false);
  eq(s.leaves, 3);
  eq(s.done, 1);
  eq(s.inprogress, 1);
  eq(s.overall, 50);
});

test("dashboard.wbsSummary: 期限超過は未完かつ終了日が基準日より前の葉のみ（完了・期限なしは対象外）", (MK) => {
  // 観点: overdue の判定が「done 以外 かつ end < today かつ end 設定あり」であること（決定的・基準日注入）
  // 入力: 基準日 2026-07-06。期限切れ未完1 / 期限切れだが完了1 / 未来1 / 期限なし未完1
  // 期待: overdue=1（期限切れ未完のみ）
  const D = MK.logic.dashboard;
  const p = MK.projects.create({ name: "PJ-Y" });
  seedWbs(MK, p.id, [
    { id: 1, level: 0, name: "期限切れ未完", status: "inprogress", progress: 30, end: "2026-07-01", deps: [] },
    { id: 2, level: 0, name: "期限切れ完了", status: "done", progress: 100, end: "2026-07-01", deps: [] },
    { id: 3, level: 0, name: "未来", status: "notstarted", progress: 0, end: "2026-08-01", deps: [] },
    { id: 4, level: 0, name: "期限なし", status: "notstarted", progress: 0, end: "", deps: [] },
  ]);
  eq(D.wbsSummary(p.id, "2026-07-06").overdue, 1);
});

test("dashboard.allocationsFor: 対象PJのアロケーションを解決し、基準日で active を判定する", (MK) => {
  // 観点: 共有マスタ MK.allocations から対象PJ分だけを拾い、メンバー名解決と期間内フラグを付ける
  // 入力: PJ-A へ2件（期間内 / 期間外）、PJ-B へ1件。基準日 2026-07-06
  // 期待: PJ-A は2件返り active=[true,false]、他PJ分は混ざらない
  const D = MK.logic.dashboard;
  const a = MK.projects.create({ name: "PJ-A" });
  const b = MK.projects.create({ name: "PJ-B" });
  const m = MK.people.resolveOrCreate("担当者");
  MK.allocations.create({ memberId: m, targetId: a.id, startDate: "2026-07-01", endDate: "2026-07-31", percent: 50 });
  MK.allocations.create({ memberId: m, targetId: a.id, startDate: "2026-01-01", endDate: "2026-06-30", percent: 30 });
  MK.allocations.create({ memberId: m, targetId: b.id, startDate: "2026-07-01", endDate: "2026-07-31", percent: 40 });
  const rows = D.allocationsFor(a.id, "2026-07-06");
  eq(rows.length, 2);
  eq(rows[0].memberName, "担当者");
  eq(rows[0].active, true);
  eq(rows[1].active, false);
});

test("dashboard.productsFor: projectIds に対象PJを含む Product だけを返す", (MK) => {
  // 観点: Product⇄Project の緩い紐付け（projectIds）から、対象PJに関連する Product を抽出する
  // 入力: 対象PJを含む Product1件・含まない Product1件
  // 期待: 対象PJを含む1件のみ
  const D = MK.logic.dashboard;
  const a = MK.projects.create({ name: "PJ-A" });
  const b = MK.projects.create({ name: "PJ-B" });
  MK.products.create({ name: "関連プロダクト", projectIds: [a.id] });
  MK.products.create({ name: "無関係プロダクト", projectIds: [b.id] });
  const list = D.productsFor(a.id);
  eq(list.length, 1);
  eq(list[0].name, "関連プロダクト");
});
