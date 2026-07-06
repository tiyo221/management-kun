/* 任意契約リーダ MK.readSummary（spec §9.5 柱1・着脱耐性）—
   横断表示が他モジュールをハード参照せず「あれば読む／無ければ null」で安全に問い合わせられること。
   MK_CONFIG からモジュールを外しても（＝未搭載でも）、summary 未実装でも、summary が例外でも、
   呼び手（HOME サマリー・集約ビュー #83）が壊れないことを担保する。DOM 非依存。 */
"use strict";

test("readSummary: 未搭載モジュール（着脱で外した id）は null（例外にしない）", (MK) => {
  // 観点: MK_CONFIG から外した／未登録の id を問い合わせても壊れず null を返す（保証3: 枠を黙って省く）
  eq(MK.readSummary("__not_registered__"), null);
});

test("readSummary: summary を実装しないモジュールは null", (MK) => {
  // 観点: def はあるが summary 任意契約を持たないモジュールは null（description だけ等）
  MK.registerModule("__no_summary__", { description: "x" });
  eq(MK.readSummary("__no_summary__"), null);
});

test("readSummary: summary があれば結果をそのまま返し、引数も渡す", (MK) => {
  // 観点: 正常系。summary(arg) の戻り値を透過し、基準日などの引数を素通しする
  MK.registerModule("__ok__", { summary: (arg) => ({ empty: false, arg: arg || null }) });
  eq(MK.readSummary("__ok__"), { empty: false, arg: null });
  eq(MK.readSummary("__ok__", "2026-07-06"), { empty: false, arg: "2026-07-06" });
});

test("readSummary: summary が例外を投げても null に握って呼び手へ伝播しない", (MK) => {
  // 観点: 1モジュールの summary バグが横断表示（HOME）全体を巻き添えにしない（保証1: 起動が壊れない）
  MK.registerModule("__throws__", { summary: () => { throw new Error("boom"); } });
  eq(MK.readSummary("__throws__"), null);
});

test("readSummary: 混在リストを集約しても、壊れた/未搭載を飛ばして完走する", (MK) => {
  // 観点: 横断表示の実利用形。良い/未搭載/例外 が混ざったモジュール列を集約しても throw せず、
  //       読めたものだけ集まる（着脱・部分障害に対する集約側の堅牢性）
  MK.registerModule("__good__", { summary: () => ({ empty: false }) });
  MK.registerModule("__bad__", { summary: () => { throw new Error("boom"); } });
  const ids = ["__good__", "__absent__", "__bad__"];
  const got = ids.map((id) => MK.readSummary(id)).filter((s) => s != null);
  eq(got.length, 1);
  eq(got[0], { empty: false });
});
