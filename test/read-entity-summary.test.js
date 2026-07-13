/* 任意契約リーダ MK.readEntitySummary（spec §3.6 / §9.5 柱1・着脱耐性）—
   エンティティ（人1人・PJ1つ）単位のサマリーを、他モジュールをハード参照せず
   「あれば読む／無ければ null」で安全に問い合わせられること。readSummary と同じ原則で、
   未搭載（MK_CONFIG から外した id）・summaryFor 未実装・summaryFor が例外のいずれでも
   呼び手（人・プロジェクト詳細の集約ビュー #83）が壊れないことを担保する。DOM 非依存。 */
"use strict";

test("readEntitySummary: 未搭載モジュール（着脱で外した id）は null（例外にしない）", (MK) => {
  // 観点: MK_CONFIG から外した／未登録の id を問い合わせても壊れず null（保証3: 枠を黙って省く）
  // 入力: 未登録 id に person/p1 を指定して readEntitySummary
  // 期待: 例外にならず null
  eq(MK.readEntitySummary("__not_registered__", "person", "p1"), null);
});

test("readEntitySummary: summaryFor を実装しないモジュールは null", (MK) => {
  // 観点: def はあるが summaryFor 任意契約を持たないモジュール（summary だけ等）は null
  // 入力: summary は持つが summaryFor を持たない def を登録して readEntitySummary
  // 期待: null（エンティティ単位の任意契約を実装しないモジュールは集約に出さない）
  MK.registerModule("__no_entity__", { summary: () => ({ empty: false, stats: [] }) });
  eq(MK.readEntitySummary("__no_entity__", "person", "p1"), null);
});

test("readEntitySummary: summaryFor があれば結果をそのまま返し、entityType/id を渡す", (MK) => {
  // 観点: 正常系。summaryFor(entityType, id) の戻り値を透過し、引数を素通しする（summary() 同型の戻り値）
  // 入力: 受け取った type/id を stats へ載せる summaryFor を登録し、person/p1 と project/pj9 で呼ぶ
  // 期待: 戻り値をそのまま透過し、渡した entityType/id が stats に反映される
  MK.registerModule("__ok__", {
    summaryFor: (type, id) => ({ empty: false, stats: [{ label: "type", value: type }, { label: "id", value: id }] }),
  });
  eq(MK.readEntitySummary("__ok__", "person", "p1"), { empty: false, stats: [{ label: "type", value: "person" }, { label: "id", value: "p1" }] });
  eq(MK.readEntitySummary("__ok__", "project", "pj9"), { empty: false, stats: [{ label: "type", value: "project" }, { label: "id", value: "pj9" }] });
});

test("readEntitySummary: マスタ種別に汎用（project 決め打ち分岐なし）", (MK) => {
  // 観点: §3.7.6。entityType を素通しするだけで、"project" 等の特定種別に特別扱いをしない
  // 入力: type をそのまま返す summaryFor を登録し、product と任意文字列 "anything" で呼ぶ
  // 期待: どちらも渡した entityType がそのまま返る（種別ごとの分岐がない）
  MK.registerModule("__generic__", { summaryFor: (type) => ({ empty: false, stats: [{ label: "t", value: type }] }) });
  eq(MK.readEntitySummary("__generic__", "product", "pr1").stats[0].value, "product");
  eq(MK.readEntitySummary("__generic__", "anything", "x").stats[0].value, "anything");
});

test("readEntitySummary: summaryFor が例外を投げても null に握って呼び手へ伝播しない", (MK) => {
  // 観点: 1モジュールの summaryFor バグが集約ビュー（#83）全体を巻き添えにしない（保証1: 起動が壊れない）
  // 入力: summaryFor が必ず throw する def を登録して readEntitySummary
  // 期待: 例外を握りつぶして null を返す（呼び手へ伝播しない）
  MK.registerModule("__throws__", { summaryFor: () => { throw new Error("boom"); } });
  eq(MK.readEntitySummary("__throws__", "person", "p1"), null);
});

test("readEntitySummary: 混在リストを集約しても、壊れた/未搭載を飛ばして完走する", (MK) => {
  // 観点: 集約ビューの実利用形。良い/未搭載/例外 が混ざったモジュール列を同一エンティティで集約しても
  //       throw せず、読めたものだけ集まる（着脱・部分障害に対する集約側の堅牢性）
  // 入力: 正常 __good__／未登録 __absent__／例外 __bad__ を同一 person/p1 で readEntitySummary し null を除外
  // 期待: throw せず、読めた1件（__good__ の summaryFor）だけが残る
  MK.registerModule("__good__", { summaryFor: () => ({ empty: false, stats: [{ label: "x", value: 1 }] }) });
  MK.registerModule("__bad__", { summaryFor: () => { throw new Error("boom"); } });
  const ids = ["__good__", "__absent__", "__bad__"];
  const got = ids.map((id) => MK.readEntitySummary(id, "person", "p1")).filter((s) => s != null);
  eq(got.length, 1);
  eq(got[0], { empty: false, stats: [{ label: "x", value: 1 }] });
});
