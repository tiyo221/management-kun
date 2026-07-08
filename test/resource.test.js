/* resource（リソース＝要員計画）ロジック — 人単位換算・不足/外注判定・負担の純関数（Issue #71 / #52 / 旧 #27） */
"use strict";

test("resource: fteLabel は % を人（FTE・1人=100%）へ換算する", (MK) => {
  // 観点: 主単位を % → 人にする換算（Issue #71 受け入れ条件）。小数1桁へ丸め、常に1桁表示
  // 入力: 90% / 200% / 0% / -20%（負の空き）/ 85%（丸め境界）
  // 期待: "0.9人" / "2.0人" / "0.0人" / "-0.2人" / "0.9人"（85→8.5→四捨五入9→0.9）
  const S = MK.logic.resource;
  eq(S.fteLabel(90), "0.9人");
  eq(S.fteLabel(200), "2.0人");
  eq(S.fteLabel(0), "0.0人");
  eq(S.fteLabel(-20), "-0.2人");
  eq(S.fteLabel(85), "0.9人");
});

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

test("resource: 過負担は負の空きで表す（クランプしない）", (MK) => {
  // 観点: 100%超の割当は過負担として負値で可視化する（0で丸めない）
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

test("resource: shortageMatrix は PJ別×月別の不足（需要−確保）を返す（問い①）", (MK) => {
  // 観点: 「あと何人足りない？」の中核。器ごとに 需要 − その器への割当合計 を月次で出す（Issue #71）
  // 入力: 7月に PJ-a 需要200% / 供給(60+50)=110%、PJ-b 需要100% / 供給100%。8月は需要・供給なし
  // 期待: a は gap=90 で short、b は gap=0 で充足。8月は demand=0 で short=false
  const S = MK.logic.resource;
  const allocations = [
    { memberId: "m1", targetId: "a", percent: 60, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m3", targetId: "b", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const demands = [
    { targetId: "a", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "b", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }, { id: "b", name: "PJ-B", dim: "project" }];
  const mx = S.shortageMatrix(allocations, demands, targets, ["2026-07-01", "2026-08-01"]);
  eq(mx.rows[0].cells[0].demand, 200);
  eq(mx.rows[0].cells[0].supply, 110);
  eq(mx.rows[0].cells[0].gap, 90);
  eq(mx.rows[0].cells[0].short, true);
  eq(mx.rows[0].anyShort, true);
  eq(mx.rows[1].cells[0].gap, 0);
  eq(mx.rows[1].cells[0].short, false);
  eq(mx.rows[0].cells[1].demand, 0); // 8月は需要なし
  eq(mx.rows[0].cells[1].short, false);
});

test("resource: shortageMatrix の不足合計は他PJの余剰で相殺しない", (MK) => {
  // 観点: 不足合計 = Σ max(0, gap)。PJ-b の供給過多（余剰）が PJ-a の不足を打ち消してはいけない（Issue #71）
  // 入力: 7月に PJ-a 需要100%/供給0%（不足100）、PJ-b 需要0%/供給50%（余剰50）
  // 期待: totals.shortage=100（100-50=50 ではない）・short=true
  const S = MK.logic.resource;
  const allocations = [{ memberId: "m1", targetId: "b", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [{ targetId: "a", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }, { id: "b", name: "PJ-B", dim: "project" }];
  const mx = S.shortageMatrix(allocations, demands, targets, ["2026-07-01"]);
  eq(mx.totals[0].shortage, 100);
  eq(mx.totals[0].short, true);
});

test("resource: shortageMatrix は器×ロールで不足を出し役割ミスマッチを不足として残す（問い①・#134）", (MK) => {
  // 観点: 需要に role があれば「器 × ロール」で行を分割し、供給はそのロールのメンバー（member.role 由来）だけで賄う。
  //       PM を エンジニア枠へ充てても不足は埋まらない（役割ミスマッチ）。allocation にロールは保存しない。
  // 入力: PJ-a に エンジニア200% / デザイナー100% の需要。供給は m1(エンジニア)100% + m3(PM)50% + m2(デザイナー)60% を a へ
  // 期待: エンジニア行 gap=100（PM の50%は不算入）、デザイナー行 gap=40
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }, { id: "m2", role: "デザイナー" }, { id: "m3", role: "PM" }];
  const allocations = [
    { memberId: "m1", targetId: "a", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m3", targetId: "a", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 60, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const demands = [
    { targetId: "a", role: "エンジニア", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "a", role: "デザイナー", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }];
  const mx = S.shortageMatrix(allocations, demands, targets, ["2026-07-01"], members);
  eq(mx.rows.length, 2);
  const eng = mx.rows.find((r) => r.roleNorm === "エンジニア"), des = mx.rows.find((r) => r.roleNorm === "デザイナー");
  eq(eng.cells[0].demand, 200);
  eq(eng.cells[0].supply, 100); // PM の 50% は エンジニア枠に入らない
  eq(eng.cells[0].gap, 100);
  eq(des.cells[0].supply, 60);
  eq(des.cells[0].gap, 40);
  eq(mx.totals[0].shortage, 140); // 100 + 40
});

test("resource: role 未設定の需要は器単位の供給で賄う（後方互換・#134）", (MK) => {
  // 観点: role 空の需要はロールを問わず器全体の供給で賄う（従来挙動へ縮退）。memberList を渡しても結果は器単位
  // 入力: PJ-a role未設定で需要200%。供給は役割の異なる m1(エンジニア)100% + m2(デザイナー)60%
  // 期待: supply=160（ロールを問わず合算）、gap=40
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }, { id: "m2", role: "デザイナー" }];
  const allocations = [
    { memberId: "m1", targetId: "a", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 60, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const demands = [{ targetId: "a", role: "", requiredPercent: 200, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }];
  const mx = S.shortageMatrix(allocations, demands, targets, ["2026-07-01"], members);
  eq(mx.rows.length, 1);
  eq(mx.rows[0].roleNorm, "");
  eq(mx.rows[0].cells[0].supply, 160);
  eq(mx.rows[0].cells[0].gap, 40);
});

test("resource: 同一器でロール空とロール指定の需要が混在すると供給が二重計上される（既知の縮退・UIで入力抑止・#134）", (MK) => {
  // 観点: ロール空行は器全体の供給、ロール指定行はそのロールの供給を数えるため、同一器で混在すると同じ供給が
  //       両行に効いて不足を過小評価する。厳密な充当（スロット割当）は YAGNI として持たず、view.editDemand が
  //       保存時に混在を拒否する。ここでは logic の挙動（＝混在は非対応）を固定し、退行時に気づけるようにする。
  // 入力: 器a に エンジニア100% と ロール空100% の需要。供給は m1(エンジニア)100% のみ（実際は200必要/100供給＝100不足）
  // 期待: エンジニア行 gap=0（供給100）・空行 gap=0（供給100を再カウント）→ totals.shortage=0（過小評価。混在は非対応）
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }];
  const allocations = [{ memberId: "m1", targetId: "a", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [
    { targetId: "a", role: "エンジニア", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
    { targetId: "a", role: "", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }];
  const mx = S.shortageMatrix(allocations, demands, targets, ["2026-07-01"], members);
  const eng = mx.rows.find((r) => r.roleNorm === "エンジニア"), agn = mx.rows.find((r) => r.roleNorm === "");
  eq(eng.cells[0].supply, 100);
  eq(agn.cells[0].supply, 100); // 同じ m1 の供給を再カウント（混在は非対応ゆえの縮退）
  eq(mx.totals[0].shortage, 0); // 過小評価。混在は view で入力抑止する
});

test("resource: 外注前提のロール（内部に該当者なし）は空きで吸収されず外注候補として残る（問い②・#134）", (MK) => {
  // 観点: ロール別の不足は同じロールのメンバーの空きでしか吸収できない。内部に居ないロールは外注候補として残す
  // 入力: PJ-a に データサイエンティスト100% の需要（供給0）。メンバーは エンジニア m1 が 20%割当（空き80%）のみ
  // 期待: 不足100% は エンジニアの空き80% では吸収されず outsource=100 / needsOutsource=true
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }];
  const allocations = [{ memberId: "m1", targetId: "b", percent: 20, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [{ targetId: "a", role: "データサイエンティスト", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }, { id: "b", name: "PJ-B", dim: "project" }];
  const rows = S.outsourcingByMonth(allocations, demands, targets, members, ["2026-07-01"]);
  eq(rows[0].shortage, 100);
  eq(rows[0].outsource, 100); // エンジニアの空きでは吸収不可
  eq(rows[0].needsOutsource, true);
});

test("resource: ロール別の不足は同ロールの空きで吸収できれば外注不要（問い②・#134）", (MK) => {
  // 観点: 同じロールのメンバーに空きがあれば内部で吸収（役割一致時は従来通り）
  // 入力: PJ-a に エンジニア100% の需要・供給0。エンジニア m1 は別PJに30%（空き70%）、エンジニア m2 は空き100%
  // 期待: エンジニアの空き 170% ≥ 不足100% → outsource=0 / needsOutsource=false
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }, { id: "m2", role: "エンジニア" }];
  const allocations = [{ memberId: "m1", targetId: "b", percent: 30, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [{ targetId: "a", role: "エンジニア", requiredPercent: 100, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }, { id: "b", name: "PJ-B", dim: "project" }];
  const rows = S.outsourcingByMonth(allocations, demands, targets, members, ["2026-07-01"]);
  eq(rows[0].outsource, 0);
  eq(rows[0].needsOutsource, false);
});

test("resource: roleVocabulary は People.role ∪ 需要role を正規化重複排除で返す（#134）", (MK) => {
  // 観点: datalist の候補語彙＝People の既出 role ∪ 既存需要 role。正規化（trim+小文字）で重複排除、空は除外
  // 入力: People に「エンジニア」「 エンジニア 」(重複)「PM」、需要に「デザイナー」「pm」(既出)「」(空)
  // 期待: ["エンジニア","PM","デザイナー"]（People 先・需要後・重複/空なし）
  const S = MK.logic.resource;
  const members = [{ id: "m1", role: "エンジニア" }, { id: "m2", role: " エンジニア " }, { id: "m3", role: "PM" }];
  const demands = [{ role: "デザイナー" }, { role: "pm" }, { role: "" }];
  eq(S.roleVocabulary(members, demands), ["エンジニア", "PM", "デザイナー"]);
});

test("resource: teamFreeOn はメンバーごとの空きを0でクランプして合算する", (MK) => {
  // 観点: 過負担メンバーの負の空きは、他の不足を埋める原資にならない（問い②の分母。Issue #71）
  // 入力: m1 は 120%（空き-20→0扱い）、m2 は 40%（空き60）
  // 期待: チームの空き = 0 + 60 = 60%
  const S = MK.logic.resource;
  const members = [{ id: "m1" }, { id: "m2" }];
  const list = [
    { memberId: "m1", targetId: "a", percent: 120, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  eq(S.teamFreeOn(list, members, "2026-07-15"), 60);
});

test("resource: outsourcingByMonth は空きで吸収できない不足を外注候補として返す（問い②）", (MK) => {
  // 観点: 「外注が要る？」= 不足（①の合計）をチームの空き要員で吸収できるかの月次判定（Issue #71）
  // 入力: 7月 不足90%（PJ-a 需要200/供給110）に対しチームの空き = m1:0 + m2:50 + m3:10 = 60%
  // 期待: absorbed=60 / outsource=30 / needsOutsource=true
  const S = MK.logic.resource;
  const members = [{ id: "m1" }, { id: "m2" }, { id: "m3" }];
  const allocations = [
    { memberId: "m1", targetId: "a", percent: 100, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m3", targetId: "a", percent: 90, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const demands = [{ targetId: "a", requiredPercent: 330, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }];
  const rows = S.outsourcingByMonth(allocations, demands, targets, members, ["2026-07-01"]);
  eq(rows[0].shortage, 90);   // 330 - (100+50+90) = 90
  eq(rows[0].internalFree, 60);
  eq(rows[0].absorbed, 60);
  eq(rows[0].outsource, 30);
  eq(rows[0].needsOutsource, true);
});

test("resource: 不足が空きで吸収できる月は外注不要（問い②）", (MK) => {
  // 観点: 内部の空き ≥ 不足 なら外注候補は0（「足りない」と「外注」を繋ぐ判定）
  // 入力: 7月 不足40% に対しチームの空き60%（m1: 40%割当）
  // 期待: outsource=0 / needsOutsource=false / absorbed=40
  const S = MK.logic.resource;
  const members = [{ id: "m1" }];
  const allocations = [{ memberId: "m1", targetId: "a", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const demands = [{ targetId: "a", requiredPercent: 80, startDate: "2026-07-01", endDate: "2026-07-31" }];
  const targets = [{ id: "a", name: "PJ-A", dim: "project" }];
  const rows = S.outsourcingByMonth(allocations, demands, targets, members, ["2026-07-01"]);
  eq(rows[0].shortage, 40);
  eq(rows[0].outsource, 0);
  eq(rows[0].needsOutsource, false);
  eq(rows[0].absorbed, 40);
});

test("resource: memberLoadByMonth は月別負荷と1人分超え（over）を返す（問い③）", (MK) => {
  // 観点: 「負担は大丈夫？」= 割当が1人分（100%）を超えるメンバー×月を識別する（Issue #71）
  // 入力: m1 は 7月に 70+50=120%（超過20）・8月は割当なし。m2 は 7月に 40%
  // 期待: m1 7月 over=true/overBy=20・8月 assigned=0、m2 は anyOver=false。peak も検証
  const S = MK.logic.resource;
  const members = [{ id: "m1", name: "一郎" }, { id: "m2", name: "花子" }];
  const list = [
    { memberId: "m1", targetId: "a", percent: 70, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m1", targetId: "b", percent: 50, startDate: "2026-07-01", endDate: "2026-07-31" },
    { memberId: "m2", targetId: "a", percent: 40, startDate: "2026-07-01", endDate: "2026-07-31" },
  ];
  const rows = S.memberLoadByMonth(list, members, ["2026-07-01", "2026-08-01"]);
  eq(rows[0].cells[0].assigned, 120);
  eq(rows[0].cells[0].over, true);
  eq(rows[0].cells[0].overBy, 20);
  eq(rows[0].cells[1].assigned, 0);
  eq(rows[0].anyOver, true);
  eq(rows[0].peak, 120);
  eq(rows[1].cells[0].over, false);
  eq(rows[1].anyOver, false);
  eq(rows[1].peak, 40);
});

test("resource: summary はアロケーション由来で空き要員（人）と過負担人数を返す", (MK) => {
  // 観点: データ源は中立な共有マスタ MK.allocations のみ＝モジュール独立。HOME サマリー（§3.6）を人単位で（Issue #71）
  // 入力: 本日を含む期間で m1 に 120%（過負担）、m2 に 40% を共有マスタへ登録
  // 期待: empty=false、空き要員 = max(0,-20)+60 = 60% → "0.6人"、過負担 "1人"
  const S = MK.logic.resource;
  const m1 = MK.people.resolveOrCreate("過剰さん"), m2 = MK.people.resolveOrCreate("余裕さん");
  const today = MK.util.todayISO(), end = MK.util.addDays(today, 30);
  MK.allocations.create({ memberId: m1, targetId: "a", percent: 70, startDate: today, endDate: end });
  MK.allocations.create({ memberId: m1, targetId: "b", percent: 50, startDate: today, endDate: end });
  MK.allocations.create({ memberId: m2, targetId: "a", percent: 40, startDate: today, endDate: end });
  const sum = S.summary();
  eq(sum.empty, false);
  eq(sum.stats[0].value, "0.6人"); // 空き要員（過負担の負値は0クランプ）
  eq(sum.stats[1].value, "1人");   // 過負担 1人（m1）
});

test("resource: アロケーション皆無なら summary は empty", (MK) => {
  // 観点: データ源（アロケーション）が無ければ HOME は「データがありません」
  // 入力: メンバーは居るがアロケーション0件
  // 期待: empty=true
  const S = MK.logic.resource;
  MK.people.resolveOrCreate("誰か");
  eq(S.summary().empty, true);
});
