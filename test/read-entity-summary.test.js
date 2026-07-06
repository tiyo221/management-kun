/* 任意契約リーダ MK.readEntitySummary（spec §3.6 / §9.5 柱1・着脱耐性）—
   エンティティ（人1人・PJ1つ）単位のサマリーを、他モジュールをハード参照せず
   「あれば読む／無ければ null」で安全に問い合わせられること。readSummary と同じ原則で、
   未搭載（MK_CONFIG から外した id）・summaryFor 未実装・summaryFor が例外のいずれでも
   呼び手（人・プロジェクト詳細の集約ビュー #83）が壊れないことを担保する。DOM 非依存。 */
"use strict";

test("readEntitySummary: 未搭載モジュール（着脱で外した id）は null（例外にしない）", (MK) => {
  // 観点: MK_CONFIG から外した／未登録の id を問い合わせても壊れず null（保証3: 枠を黙って省く）
  eq(MK.readEntitySummary("__not_registered__", "person", "p1"), null);
});

test("readEntitySummary: summaryFor を実装しないモジュールは null", (MK) => {
  // 観点: def はあるが summaryFor 任意契約を持たないモジュール（summary だけ等）は null
  MK.registerModule("__no_entity__", { summary: () => ({ empty: false, stats: [] }) });
  eq(MK.readEntitySummary("__no_entity__", "person", "p1"), null);
});

test("readEntitySummary: summaryFor があれば結果をそのまま返し、entityType/id を渡す", (MK) => {
  // 観点: 正常系。summaryFor(entityType, id) の戻り値を透過し、引数を素通しする（summary() 同型の戻り値）
  MK.registerModule("__ok__", {
    summaryFor: (type, id) => ({ empty: false, stats: [{ label: "type", value: type }, { label: "id", value: id }] }),
  });
  eq(MK.readEntitySummary("__ok__", "person", "p1"), { empty: false, stats: [{ label: "type", value: "person" }, { label: "id", value: "p1" }] });
  eq(MK.readEntitySummary("__ok__", "project", "pj9"), { empty: false, stats: [{ label: "type", value: "project" }, { label: "id", value: "pj9" }] });
});

test("readEntitySummary: マスタ種別に汎用（project 決め打ち分岐なし）", (MK) => {
  // 観点: §3.7.6。entityType を素通しするだけで、"project" 等の特定種別に特別扱いをしない
  MK.registerModule("__generic__", { summaryFor: (type) => ({ empty: false, stats: [{ label: "t", value: type }] }) });
  eq(MK.readEntitySummary("__generic__", "product", "pr1").stats[0].value, "product");
  eq(MK.readEntitySummary("__generic__", "anything", "x").stats[0].value, "anything");
});

test("readEntitySummary: summaryFor が例外を投げても null に握って呼び手へ伝播しない", (MK) => {
  // 観点: 1モジュールの summaryFor バグが集約ビュー（#83）全体を巻き添えにしない（保証1: 起動が壊れない）
  MK.registerModule("__throws__", { summaryFor: () => { throw new Error("boom"); } });
  eq(MK.readEntitySummary("__throws__", "person", "p1"), null);
});

test("readEntitySummary: 混在リストを集約しても、壊れた/未搭載を飛ばして完走する", (MK) => {
  // 観点: 集約ビューの実利用形。良い/未搭載/例外 が混ざったモジュール列を同一エンティティで集約しても
  //       throw せず、読めたものだけ集まる（着脱・部分障害に対する集約側の堅牢性）
  MK.registerModule("__good__", { summaryFor: () => ({ empty: false, stats: [{ label: "x", value: 1 }] }) });
  MK.registerModule("__bad__", { summaryFor: () => { throw new Error("boom"); } });
  const ids = ["__good__", "__absent__", "__bad__"];
  const got = ids.map((id) => MK.readEntitySummary(id, "person", "p1")).filter((s) => s != null);
  eq(got.length, 1);
  eq(got[0], { empty: false, stats: [{ label: "x", value: 1 }] });
});
