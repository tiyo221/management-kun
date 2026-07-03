/* oneonone ロジック */
"use strict";

test("oneonone: エントリ追加は memberId 必須・先頭挿入・アクション正規化", (MK) => {
  // 観点: memberId なしは追加されない。追加は unshift。空 text のアクションは除外され id が付く。
  const O = MK.logic.oneonone;
  eq(O.addEntry({ body: "no member" }), null);
  eq(O.entries().length, 0);
  const e = O.addEntry({ memberId: "m1", date: "2026-07-01", body: "話した", actions: [{ text: "やること" }, { text: "  " }] });
  assert(e && e.id[0] === "o", "id は o プレフィックス");
  eq(O.entries().length, 1);
  eq(e.actions.length, 1);
  assert(e.actions[0].id[0] === "a", "アクション id は a プレフィックス");
  eq(e.actions[0].done, false);
  eq(e.actions[0].due, null);
});

test("oneonone: entriesOf は日付の新しい順・memberId で絞り込み", (MK) => {
  // 観点: 指定メンバーのみ、date 降順で返る
  const O = MK.logic.oneonone;
  O.addEntry({ memberId: "m1", date: "2026-06-01", body: "古い" });
  O.addEntry({ memberId: "m1", date: "2026-07-01", body: "新しい" });
  O.addEntry({ memberId: "m2", date: "2026-07-02", body: "別人" });
  const list = O.entriesOf("m1");
  eq(list.length, 2);
  eq(list[0].date, "2026-07-01");
  eq(O.lastDateOf("m1"), "2026-07-01");
  eq(O.lastDateOf("m9"), null);
});

test("oneonone: 未完アクションの集計と toggle", (MK) => {
  // 観点: openActionsOf / openActionCount は未完のみ数える。toggleAction で done が反転。
  const O = MK.logic.oneonone;
  const e = O.addEntry({ memberId: "m1", date: "2026-07-01", body: "b", actions: [{ text: "A" }, { text: "B", done: true }] });
  eq(O.openActionCount(), 1);
  eq(O.openActionsOf("m1").length, 1);
  const openId = e.actions.find((a) => a.text === "A").id;
  O.toggleAction(e.id, openId);
  eq(O.openActionCount(), 0);
  O.toggleAction(e.id, openId);
  eq(O.openActionCount(), 1);
});

test("oneonone: updateEntry は部分更新＋actions 正規化、removeEntry で削除", (MK) => {
  // 観点: body/mood を更新できる。actions を渡すと再正規化。削除で消える。
  const O = MK.logic.oneonone;
  const e = O.addEntry({ memberId: "m1", date: "2026-07-01", body: "old" });
  O.updateEntry(e.id, { body: "new", mood: "good", actions: [{ text: "X" }, { text: "" }] });
  const got = O.entriesOf("m1")[0];
  eq(got.body, "new");
  eq(got.mood, "good");
  eq(got.actions.length, 1);
  O.removeEntry(e.id);
  eq(O.entries().length, 0);
});

test("oneonone: summary は未完アクション件数と記録数", (MK) => {
  // 観点: 空なら empty=true。記録があれば stats[0]=未完アクション, stats[1]=記録数。
  const O = MK.logic.oneonone;
  eq(O.summary().empty, true);
  O.addEntry({ memberId: "m1", date: "2026-07-01", body: "b", actions: [{ text: "A" }] });
  O.addEntry({ memberId: "m2", date: "2026-07-02", body: "b2" });
  const s = O.summary();
  eq(s.empty, false);
  eq(s.stats[0].value, 1); // 未完アクション
  eq(s.stats[1].value, 2); // 記録数
});

test("oneonone: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  const O = MK.logic.oneonone;
  const a = O.addEntry({ memberId: "m1", date: "2026-07-01", body: "既存A" });
  O.importData({ entries: [{ id: a.id, memberId: "m1", date: "2026-07-01", body: "上書きA", actions: [] }, { id: "o_x", memberId: "m2", date: "2026-07-03", body: "新規B", actions: [] }] }, "merge");
  eq(O.entries().length, 2);
  eq(O.entries().find((x) => x.id === a.id).body, "上書きA");
  O.importData({ entries: [{ id: "o_y", memberId: "m3", date: "2026-07-04", body: "置換のみ", actions: [] }] }, "replace");
  eq(O.entries().length, 1);
});
