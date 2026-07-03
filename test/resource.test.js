/* resource（リソース＝要員計画）ロジック — 空き算出・アサイン集約・月次供給の純関数（Issue #52 / 旧 #27） */
"use strict";

test("resource: 空き = キャパ − 全器割当合計（期間内のみ・範囲外は満空き）", (MK) => {
  // 観点: 空き要員の中核式。全器を横断して割当を合算し、キャパから引く（§3.7.5）
  // 入力: PJ-A 60% / PJ-B 30%（いずれも6月）。既定キャパ100%
  // 期待: 6/15 は 100-90=10% 空き、範囲外の 5/15 は割当0で満空き100%
  const S = MK.logic.resource;
  const mid = "m1";
  const list = [
    { memberId: mid, targetId: "a", percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: mid, targetId: "b", percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  eq(S.freeOn(list, mid, "2026-06-15"), 10);
  eq(S.freeOn(list, mid, "2026-05-15"), 100);
});

test("resource: 過剰アサインは負の空きで表す（クランプしない）", (MK) => {
  // 観点: 100%超の割当は過剰アサインとして負値で可視化する（0で丸めない）
  // 入力: PJ-A 70% / PJ-B 50% = 120%
  // 期待: 空き = 100-120 = -20%
  const S = MK.logic.resource;
  const list = [
    { memberId: "m1", targetId: "a", percent: 70, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m1", targetId: "b", percent: 50, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  eq(S.freeOn(list, "m1", "2026-06-15"), -20);
});

test("resource: キャパ引数で空きの基準を変えられる", (MK) => {
  // 観点: 総キャパは引数で差し替え可能（既定100の外挿）
  // 入力: 割当40%、キャパ80%
  // 期待: 空き = 80-40 = 40%
  const S = MK.logic.resource;
  const list = [{ memberId: "m1", targetId: "a", percent: 40, startDate: "2026-06-01", endDate: "2026-06-30" }];
  eq(S.freeOn(list, "m1", "2026-06-15", 80), 40);
});

test("resource: セル割当は member×target×期間で合算する", (MK) => {
  // 観点: アサイン表の1セル。同一メンバー・同一器で期間の重なる複数割当は合算、他器・他メンバーは混ぜない
  // 入力: m1×a に 30% と 20%（重なる期間）、m1×b に 40%、m2×a に 99%
  // 期待: m1×a=50、m1×b=40、範囲外日は0
  const S = MK.logic.resource;
  const list = [
    { memberId: "m1", targetId: "a", percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m1", targetId: "a", percent: 20, startDate: "2026-06-10", endDate: "2026-06-20" },
    { memberId: "m1", targetId: "b", percent: 40, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m2", targetId: "a", percent: 99, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  eq(S.cellPercent(list, "m1", "a", "2026-06-15"), 50);
  eq(S.cellPercent(list, "m1", "b", "2026-06-15"), 40);
  eq(S.cellPercent(list, "m1", "a", "2026-05-15"), 0);
});

test("resource: overviewOn が PJ×メンバー表と空きを一括算出", (MK) => {
  // 観点: 複数PJのアサイン状況と空き要員を一覧できる（#27 受け入れ条件）
  // 入力: m1(a60,b30) / m2(a50) を6月に割当。器 a,b、メンバー m1,m2
  // 期待: 器行の合計（a=110,b=30）、メンバー別割当（m1=90,m2=50）と空き（m1=10,m2=50）
  const S = MK.logic.resource;
  const list = [
    { memberId: "m1", targetId: "a", percent: 60, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m1", targetId: "b", percent: 30, startDate: "2026-06-01", endDate: "2026-06-30" },
    { memberId: "m2", targetId: "a", percent: 50, startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  const members = [{ id: "m1", name: "一郎" }, { id: "m2", name: "花子" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }, { id: "b", name: "PJ-B", dim: "project" }];
  const ov = S.overviewOn(list, members, targets, "2026-06-15");
  eq(ov.rows.length, 2);
  eq(ov.rows[0].total, 110); // a: m1 60 + m2 50
  eq(ov.rows[1].total, 30);  // b: m1 30
  eq(ov.memberSummary[0].assigned, 90);
  eq(ov.memberSummary[0].free, 10);
  eq(ov.memberSummary[1].assigned, 50);
  eq(ov.memberSummary[1].free, 50);
  eq(ov.memberSummary[0].over, false);
});

test("resource: 単一PJでも自明な1件として成立（縮退）", (MK) => {
  // 観点: 器が1件でも横断ビューは成立する（§3.7.2 の縮退・#27 受け入れ条件）
  // 入力: 器 a のみ、m1 を 40% 割当
  // 期待: 行1件・空き60%
  const S = MK.logic.resource;
  const list = [{ memberId: "m1", targetId: "a", percent: 40, startDate: "2026-06-01", endDate: "2026-06-30" }];
  const ov = S.overviewOn(list, [{ id: "m1", name: "一郎" }], [{ id: "a", name: "PJ-A", dim: "project" }], "2026-06-15");
  eq(ov.rows.length, 1);
  eq(ov.memberSummary[0].free, 60);
});

test("resource: freeSeries は期間軸で空きを算出する", (MK) => {
  // 観点: 「期間軸で算出・表示」（#27）。週サンプルごとに空きを返す
  // 入力: 6月のみ 70% 割当。6月内の週と6月外の週
  // 期待: 6月内は空き30%、範囲外は満空き100%
  const S = MK.logic.resource;
  const list = [{ memberId: "m1", targetId: "a", percent: 70, startDate: "2026-06-01", endDate: "2026-06-30" }];
  const weeks = ["2026-05-25", "2026-06-15", "2026-07-06"];
  eq(S.freeSeries(list, "m1", weeks), [100, 30, 100]);
});

test("resource: monthsInHorizon は今月起点の月初日を粗い月数で返す（要員確保のリードタイム向け）", (MK) => {
  // 観点: 週次は手遅れ・マイクロマネジメントのため月次×長ホライズンで先まで見せる（Issue #52）
  // 入力: 四半期(13週) → 約3ヶ月。today からの相対で検証（システム日付に依存しない）
  // 期待: 先頭が今月初日、連続する月初日、offset で翌月起点にずれる
  const S = MK.logic.resource;
  const today = MK.util.todayISO();
  const thisMonthFirst = today.slice(0, 7) + "-01";
  // 翌月の初日を素朴に算出（年跨ぎ込み）
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const nextIdx = m; // m は1..12（今月の1-based番号）。(nextIdx % 12)+1 で翌月へ、Math.floor(nextIdx/12) で年跨ぎを補正する
  const nextMonthFirst = (y + Math.floor(nextIdx / 12)) + "-" + String((nextIdx % 12) + 1).padStart(2, "0") + "-01";
  const months = S.monthsInHorizon(13, 0);
  eq(months.length, 3);
  eq(months[0], thisMonthFirst);
  eq(months[1], nextMonthFirst);
  months.forEach((mo) => assert(/^\d{4}-\d{2}-01$/.test(mo), "月初日 YYYY-MM-01"));
  eq(S.monthsInHorizon(13, 1)[0], nextMonthFirst); // offset で翌月起点
});

test("resource: monthsInHorizon は baseDate 注入で年跨ぎを決定的に扱う", (MK) => {
  // 観点: 12月起点や負 offset で年をまたいでも月初日が正しく桁上がり／桁下がりする（システム日付に依存しない）
  // 入力: 基準日 2026-12-10・四半期(13週=3ヶ月) / 同基準日で offset -1
  // 期待: 12月→翌年1月→2月 と繰り上がる。offset -1 は前月 11月起点
  const S = MK.logic.resource;
  eq(S.monthsInHorizon(13, 0, "2026-12-10"), ["2026-12-01", "2027-01-01", "2027-02-01"]);
  eq(S.monthsInHorizon(13, -1, "2026-01-10")[0], "2025-12-01"); // 負 offset で前年へ桁下がり
});

test("resource: supplyByMonth はチーム総割当・キャパ・空き・過剰人数を月次で返す", (MK) => {
  // 観点: 供給がキャパを超える月＝オーバーコミットを月次で早期警告する（Issue #52）
  // 入力: m1 は 7月に120%（過剰）、m2 は 7月に40%。8月は割当なし。メンバー2名＝総キャパ200%
  // 期待: 7月 assigned=160/cap=200/free=40/overCount=1、8月 assigned=0/free=200/overCount=0
  const S = MK.logic.resource;
  const members = [{ id: "m1" }, { id: "m2" }];
  const list = [
    { memberId: "m1", targetId: "a", percent: 70, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m1", targetId: "b", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const rows = S.supplyByMonth(list, members, ["2026-07-01", "2026-08-01"]);
  eq(rows[0].assigned, 160);
  eq(rows[0].cap, 200);
  eq(rows[0].free, 40);
  eq(rows[0].overCount, 1);
  eq(rows[1].assigned, 0);
  eq(rows[1].free, 200);
  eq(rows[1].overCount, 0);
});

test("resource: gapByMonth は需要 − 約束済み供給を月次で返し、不足月を short=true にする", (MK) => {
  // 観点: 「いつまでに確保が必要か」＝ gap>0（供給不足）の月を早期に示す（Issue #68）
  // 入力: 7月に PJ-a 需要200% / 供給(割当 60+50)=110% → 不足90。8月は需要・供給なし
  // 期待: 7月 demand=200/supply=110/gap=90/short=true、8月 gap=0/short=false
  const S = MK.logic.resource;
  const allocations = [
    { memberId: "m1", targetId: "a", percent: 60, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const demands = [{ targetId: "a", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const rows = S.gapByMonth(allocations, demands, ["2026-07-01", "2026-08-01"]);
  eq(rows[0].demand, 200);
  eq(rows[0].supply, 110);
  eq(rows[0].gap, 90);
  eq(rows[0].short, true);
  eq(rows[1].gap, 0);
  eq(rows[1].short, false);
});

test("resource: 供給が需要を満たす月は gap が負・short=false（充足）", (MK) => {
  // 観点: 供給過多は不足でない（gap<=0 は充足）
  // 入力: 需要80% に対し供給100%
  // 期待: gap=-20、short=false
  const S = MK.logic.resource;
  const allocations = [{ memberId: "m1", targetId: "a", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [{ targetId: "a", requiredPercent: 80, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const rows = S.gapByMonth(allocations, demands, ["2026-07-01"]);
  eq(rows[0].gap, -20);
  eq(rows[0].short, false);
});

test("resource: summary はアロケーション由来（WBS/workload 等の内部を見ない）で空き平均と過剰人数を返す", (MK) => {
  // 観点: データ源は中立な共有マスタ MK.allocations のみ＝モジュール独立（#27/#45 受け入れ条件）。HOME サマリー（§3.6）
  // 入力: 本日を含む期間で m1 に 120%（過剰）、m2 に 40% を共有マスタへ登録
  // 期待: empty=false、過剰アサイン=1人。空きは m1=-20, m2=60 の平均=20%
  const S = MK.logic.resource;
  const m1 = MK.people.resolveOrCreate("過剰さん"), m2 = MK.people.resolveOrCreate("余裕さん");
  const today = MK.util.todayISO(), end = MK.util.addDays(today, 30);
  MK.allocations.create({ memberId: m1, targetId: "a", percent: 70, startDate: today, endDate: end });
  MK.allocations.create({ memberId: m1, targetId: "b", percent: 50, startDate: today, endDate: end });
  MK.allocations.create({ memberId: m2, targetId: "a", percent: 40, startDate: today, endDate: end });
  const sum = S.summary();
  eq(sum.empty, false);
  eq(sum.stats[1].value, 1);       // 過剰アサイン 1人（m1）
  eq(sum.stats[0].value, "20%");   // 平均空き (-20 + 60)/2 = 20%
});

test("resource: アロケーション皆無なら summary は empty", (MK) => {
  // 観点: データ源（アロケーション）が無ければ HOME は「データがありません」
  // 入力: メンバーは居るがアロケーション0件
  // 期待: empty=true
  const S = MK.logic.resource;
  MK.people.resolveOrCreate("誰か");
  eq(S.summary().empty, true);
});
