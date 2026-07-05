/* questions ロジック */
"use strict";

test("questions: 追加は open・件数・検索・タグ検索", (MK) => {
  // 観点: 追加で open/all が増え、タイトル/タグで検索できる
  // 入力: 2件追加（unshift のため items()[0] は後発）、片方にタグ付与して検索
  const Q = MK.logic.questions;
  Q.addItem("localStorage の上限");
  Q.addItem("CSS の :has()");
  eq(Q.counts().open, 2);
  eq(Q.counts().all, 2);
  const first = Q.items()[0];
  Q.updateItem(first.id, { tags: ["css"] });
  eq(Q.filtered("all", "css").length, 1);
  eq(Q.filtered("all", "localStorage").length, 1);
  // 空タイトルは追加されない
  Q.addItem("   ");
  eq(Q.counts().all, 2);
});

test("questions: resolved 遷移で resolvedAt が付き、戻すと null", (MK) => {
  // 観点: status を resolved にすると resolvedAt が設定され、open に戻すと null に戻る
  const Q = MK.logic.questions;
  Q.addItem("Promise.all と allSettled");
  const it = Q.items()[0];
  Q.updateItem(it.id, { status: "resolved", resolvedNote: "違いは…" });
  assert(Q.items()[0].resolvedAt, "resolvedAt should be set");
  eq(Q.counts().resolved, 1);
  Q.updateItem(it.id, { status: "open" });
  eq(Q.items()[0].resolvedAt, null);
});

test("questions: summary は未解決件数と今週わかった件数", (MK) => {
  // 観点: summary.stats[0]=未解決, stats[1]=今週わかった。今日解決＝今週にカウント
  const Q = MK.logic.questions;
  Q.addItem("未解決の項目");
  Q.addItem("今週わかる項目");
  const done = Q.items()[0];
  Q.updateItem(done.id, { status: "resolved" });
  const s = Q.summary();
  eq(s.empty, false);
  eq(s.stats[0].value, 1); // 未解決 1件
  eq(s.stats[1].value, 1); // 今週わかった 1件
  eq(Q.resolvedThisWeek(), 1);
});

test("questions: resolvedThisWeek は resolvedAt を現地日付で判定（UTC ズレ回帰）", (MK) => {
  // 観点: resolvedAt は UTC タイムスタンプ。現地日付に変換して月曜と比較する（.slice(0,10) の UTC 日付では TZ ズレで取りこぼす／数え過ぎる・Issue #106）
  // 入力: 基準日 today を注入（TESTING §1）。現地の月曜 00:00 と、その 1 秒前（現地の日曜）を resolvedAt に持つ 2 件
  // 期待: 現地日基準で今週=月曜以降は 1 件のみ（TZ に依存しない）
  const Q = MK.logic.questions;
  const today = "2026-07-08"; // 水曜
  const monday = MK.util.mondayOf(today); // 2026-07-06
  const atMonday = new Date(monday + "T00:00:00").toISOString(); // 現地の月曜 00:00（UTC では前日にずれ得る）
  const beforeMonday = new Date(monday + "T00:00:00"); beforeMonday.setSeconds(-1); // 現地の日曜 23:59
  Q.importData({ items: [
    { id: "q1", title: "今週わかった", status: "resolved", resolvedAt: atMonday, tags: [] },
    { id: "q2", title: "先週わかった", status: "resolved", resolvedAt: beforeMonday.toISOString(), tags: [] },
  ] }, "replace");
  eq(Q.resolvedThisWeek(today), 1);
});

test("questions: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  const Q = MK.logic.questions;
  Q.addItem("既存A");
  const a = Q.items()[0];
  Q.importData({ items: [{ id: a.id, title: "上書きA", status: "open", tags: [] }, { id: "q_x", title: "新規B", status: "open", tags: [] }] }, "merge");
  eq(Q.counts().all, 2);
  eq(Q.items().find((x) => x.id === a.id).title, "上書きA");
  Q.importData({ items: [{ id: "q_y", title: "置換のみ", status: "open", tags: [] }] }, "replace");
  eq(Q.counts().all, 1);
});
