/* questions ロジック */
"use strict";

test("questions: 追加は open・件数・検索・タグ検索", (MK) => {
  // 観点: 追加で open/all が増え、タイトル/タグで検索できる
  // 入力: 2件追加（unshift のため items()[0] は後発）、片方にタグ付与して検索
  // 期待: open=all=2、タグ "css"・タイトル "localStorage" でそれぞれ1件命中、空タイトルは追加されず all=2 のまま
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
  // 入力: 1件追加→updateItem で status="resolved"→再び status="open"
  // 期待: resolved 化で resolvedAt が入り counts().resolved=1、open へ戻すと resolvedAt=null
  const Q = MK.logic.questions;
  Q.addItem("Promise.all と allSettled");
  const it = Q.items()[0];
  Q.updateItem(it.id, { status: "resolved", resolvedNote: "違いは…" });
  assert(Q.items()[0].resolvedAt, "resolvedAt should be set");
  eq(Q.counts().resolved, 1);
  Q.updateItem(it.id, { status: "open" });
  eq(Q.items()[0].resolvedAt, null);
});

test("questions: filtered は解決内容（resolvedNote）も検索対象にする", (MK) => {
  // 観点: ナレッジ用途。回答本文のキーワードでも引ける。タイトル/タグに無い語で resolvedNote から命中
  // 入力: 「Promise の違い」を resolve("allSettled は…")、さらに未解決を1件追加
  // 期待: 回答本文の語 "allSettled" で1件命中、無関係語は0件。resolvedNote 無しの旧データが混ざっても壊れない
  const Q = MK.logic.questions;
  Q.addItem("Promise の違い");
  const it = Q.items()[0];
  Q.resolve(it.id, "allSettled は全件の結果を待つ");
  eq(Q.filtered("all", "allSettled").length, 1); // 回答本文から命中
  eq(Q.filtered("all", "存在しない語").length, 0);
  // resolvedNote 未設定（旧データ）でも壊れない
  Q.addItem("未解決のまま");
  eq(Q.filtered("all", "allSettled").length, 1);
});

test("questions: knowledge は答えありの解決済みだけを絞り込む（答えなしは除外）", (MK) => {
  // 観点: ナレッジ = resolved かつ resolvedNote あり。open/investigating も答えなし resolved も含めない
  // 入力: 「解決するもの」を resolve(答えあり)、「答えなしで閉じたもの」を updateItem で resolved(答えなし)、未解決1件
  // 期待: resolved は2件だがナレッジは答えありの1件のみ。knowledge() の検索・isKnowledge も答えの有無で切り分く
  const Q = MK.logic.questions;
  Q.addItem("解決するもの");
  Q.addItem("未解決のもの");
  Q.addItem("答えなしで閉じたもの");
  const done = Q.items().find((x) => x.title === "解決するもの");
  Q.resolve(done.id, "答え: これはナレッジ");
  // 答えを残さず閉じた resolved（＝ナレッジではない）
  const closed = Q.items().find((x) => x.title === "答えなしで閉じたもの");
  Q.updateItem(closed.id, { status: "resolved" });
  eq(Q.counts().resolved, 2); // resolved は2件
  eq(Q.counts().knowledge, 1); // うちナレッジは答えありの1件だけ
  eq(Q.knowledge().length, 1);
  eq(Q.knowledge("ナレッジ").length, 1);
  eq(Q.knowledge("未解決").length, 0); // 未解決タイトルはヒットしない
  eq(Q.isKnowledge(Q.items().find((x) => x.title === "解決するもの")), true);
  eq(Q.isKnowledge(Q.items().find((x) => x.title === "答えなしで閉じたもの")), false); // 答えなしはナレッジではない
});

test("questions: resolve は resolved 化と resolvedNote 記録と resolvedAt 設定", (MK) => {
  // 観点: 未解決→ナレッジ導線。resolve で status/resolvedNote/resolvedAt が揃う。note は trim
  // 入力: 1件追加→resolve("  余白付きの答え  ")
  // 期待: status="resolved"、resolvedNote は trim され "余白付きの答え"、resolvedAt が設定される
  const Q = MK.logic.questions;
  Q.addItem("解決対象");
  const it = Q.items()[0];
  Q.resolve(it.id, "  余白付きの答え  ");
  const after = Q.items()[0];
  eq(after.status, "resolved");
  eq(after.resolvedNote, "余白付きの答え");
  assert(after.resolvedAt, "resolvedAt should be set");
});

test("questions: summary は未解決件数と今週わかった件数", (MK) => {
  // 観点: summary.stats[0]=未解決, stats[1]=今週わかった。今日解決＝今週にカウント
  // 入力: 2件追加し、1件を今日 resolved にする
  // 期待: empty=false、stats[0].value=1（未解決）、stats[1].value=1（今週わかった）、resolvedThisWeek()=1
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

test("questions: CSV 出力・取込（ラベル/キー・タグ分割・resolvedAt）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・ステータス key/ラベル両対応・タグ分割・resolvedAt 再生成
  // 入力: 4行（resolved+タグ+答え／ラベル「調査中」／不明ステータス／タイトル空）を applyCSV
  // 期待: 取込3件（タイトル空スキップ）。タグは空白分割、resolved は resolvedAt 付与、「調査中」→investigating、
  //       不明→open、出力ヘッダは既定列順
  const Q = MK.logic.questions;
  const rows = [
    ["タイトル", "詳細", "ステータス", "タグ", "わかったこと"],
    ["localStorage の上限", "背景メモ", "resolved", "web css", "5MB 前後"],
    ["rebase と merge", "", "調査中", "git", ""], // 日本語ラベル
    ["不明ステータス", "", "なにこれ", "", ""], // 不明は open
    ["", "空行", "open", "", ""], // タイトルなしはスキップ
  ];
  const n = Q.applyCSV(rows);
  eq(n, 3);
  eq(Q.counts().all, 3);
  const a = Q.items().find((x) => x.title === "localStorage の上限");
  eq(a.status, "resolved");
  eq(a.tags, ["web", "css"]);
  eq(a.resolvedNote, "5MB 前後");
  assert(a.resolvedAt, "resolved は resolvedAt が付く");
  const b = Q.items().find((x) => x.title === "rebase と merge");
  eq(b.status, "investigating"); // 日本語ラベル「調査中」→ investigating
  eq(b.resolvedAt, null);
  const c = Q.items().find((x) => x.title === "不明ステータス");
  eq(c.status, "open"); // 不明は open
  // 出力ヘッダ
  eq(Q.buildCSVRows()[0], ["タイトル", "詳細", "ステータス", "タグ", "わかったこと"]);
});

test("questions: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  // 入力: 既存A を作り、merge で {既存A の id→上書きA, 新規B}／その後 replace で {置換のみ1件}
  // 期待: merge 後は2件（既存A が「上書きA」に）、replace 後は1件だけ残る
  const Q = MK.logic.questions;
  Q.addItem("既存A");
  const a = Q.items()[0];
  Q.importData({ items: [{ id: a.id, title: "上書きA", status: "open", tags: [] }, { id: "q_x", title: "新規B", status: "open", tags: [] }] }, "merge");
  eq(Q.counts().all, 2);
  eq(Q.items().find((x) => x.id === a.id).title, "上書きA");
  Q.importData({ items: [{ id: "q_y", title: "置換のみ", status: "open", tags: [] }] }, "replace");
  eq(Q.counts().all, 1);
});
