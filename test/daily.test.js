/* daily ロジック（タイムボクシング・todo 連携） */
"use strict";

test("daily: 手書き追加・時間割の積み上げ・並べ替え", (MK) => {
  // 観点: addManual で同日末尾に積まれ、schedule が開始起点から所要時間ぶん積んで各時刻を出す。
  //       moveItem で順序＝時刻が前後する。
  // 入力: 開始 09:00、A(30分)→B(60分)→C(15分) を追加
  // 期待: 積み上げ順 A:09:00-09:30 / B:09:30-10:30 / C:10:30-10:45、合計105分。
  //       C を1つ前へ動かすと B の前（A の後）へ。
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.setStartTime("09:00");
  D.addManual(day, "A", 30);
  D.addManual(day, "B", 60);
  D.addManual(day, "C", 15);
  const s = D.schedule(day);
  eq(s.rows.map((r) => r.item.title), ["A", "B", "C"]);
  eq(s.rows.map((r) => r.start), ["09:00", "09:30", "10:30"]);
  eq(s.rows.map((r) => r.end), ["09:30", "10:30", "10:45"]);
  eq(s.totalMin, 105);
  eq(s.endLabel, "10:45");
  eq(s.overflow, false);
  // C を1つ前へ（B と入れ替え）
  const cId = D.dayItems(day).find((it) => it.title === "C").id;
  D.moveItem(cId, -1);
  eq(D.schedule(day).rows.map((r) => r.item.title), ["A", "C", "B"]);
});

test("daily: 開始時刻の記憶と日またぎ overflow 判定", (MK) => {
  // 観点: setStartTime が記憶され schedule に効く。合計が 24 時を越えると overflow=true。
  // 入力: 開始 23:00、120分の項目1つ
  // 期待: 09:00 起点でなく 23:00 起点で 23:00-25:00、overflow=true（翌日 01:00 相当）
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.setStartTime("23:00");
  eq(D.startTime(), "23:00");
  D.addManual(day, "夜作業", 120);
  const s = D.schedule(day);
  eq(s.rows[0].start, "23:00");
  eq(s.rows[0].end, "25:00");
  eq(s.overflow, true);
});

test("daily: todo(next)から引ける・引いた項目の完了は todo と同期", (MK) => {
  // 観点: pullableTodos は next のみ返し、pull 済みは除外。完了トグルで todo 側も done/next に同期。
  // 入力: todo に next 2件・inbox 1件を作る（CSV 投入）。1件を引いて完了→解除
  // 期待: 候補は next 2件のみ→1件引くと候補1件。デイリー完了で todo が done、解除で todo が next に戻る
  const D = MK.logic.daily, T = MK.logic.todo;
  const day = "2026-07-15";
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["設計する", "next", "", "", "", ""],
    ["レビュー", "next", "", "", "", ""],
    ["あとで", "inbox", "", "", "", ""],
  ]);
  eq(D.pullableTodos(day).length, 2); // next のみ（inbox は対象外）
  const cand = D.pullableTodos(day).find((c) => c.title === "設計する");
  const itemId = D.pullFromTodo(day, cand.id, 30);
  assert(itemId, "引き込めた");
  eq(D.pullableTodos(day).length, 1);              // 引いた分は候補から外れる
  eq(D.pullFromTodo(day, cand.id, 30), null);      // 二重引き込みは不可
  // デイリーで完了 → todo も done
  D.toggleDone(itemId, true);
  eq(T.tasks().find((t) => t.title === "設計する").status, "done");
  // 解除 → todo は next へ戻る（再び引ける）
  D.toggleDone(itemId, false);
  eq(T.tasks().find((t) => t.title === "設計する").status, "next");
});

test("daily: 未完了の残りを翌日へ繰り越す（完了は残す）", (MK) => {
  // 観点: rolloverTo は未完了だけを翌日末尾へ移し、完了はその日に残す。件数を返す。
  // 入力: 7/15 に done 1件・未完 2件、翌日 7/16 に既存1件
  // 期待: 繰り越し2件。7/15 は done 1件のみ、7/16 は既存1件＋繰越2件＝3件（既存が先頭）
  const D = MK.logic.daily;
  const d1 = "2026-07-15", d2 = "2026-07-16";
  const doneId = D.addManual(d1, "済んだ", 30);
  D.addManual(d1, "残り1", 30);
  D.addManual(d1, "残り2", 30);
  D.toggleDone(doneId, true);
  D.addManual(d2, "翌日の既存", 30);
  const n = D.rolloverTo(d1, d2);
  eq(n, 2);
  eq(D.dayItems(d1).map((it) => it.title), ["済んだ"]);
  eq(D.dayItems(d2).map((it) => it.title), ["翌日の既存", "残り1", "残り2"]);
});

test("daily: summary（今日の残り・予定終了・要対応）", (MK) => {
  // 観点: 母数でなく「今日の残り」を出し、予定終了時刻を state として持つ。前日未処理は attention。
  // 入力: 基準日 7/15。7/15 に未完2件（各60分・開始09:00）、7/14 に未処理1件
  // 期待: empty=false、残り=2、予定終了=11:00、attention に「前日までの未処理 1件」
  const D = MK.logic.daily;
  D.setStartTime("09:00");
  D.addManual("2026-07-15", "X", 60);
  D.addManual("2026-07-15", "Y", 60);
  D.addManual("2026-07-14", "昨日の宿題", 30);
  const s = D.summary("2026-07-15");
  eq(s.empty, false);
  eq(s.stats[0], { label: "今日の残り", value: 2 });
  eq(s.stats[1], { label: "予定終了", value: "11:00" });
  assert(s.attention.some((a) => a.label === "前日までの未処理 1件" && a.severity === "warn"), "前日未処理を要対応に出す");
});

test("daily: JSON エクスポート/インポート（merge・replace・startTime 保持）", (MK) => {
  // 観点: exportData で startTime と items が往復し、replace は全置換、merge は id 上書き。
  // 入力: 09:30 起点で1件 → export。別データで replace / merge
  // 期待: replace で startTime・items が置き換わる。merge は id 一致で上書き＋新規追加
  const D = MK.logic.daily;
  D.setStartTime("09:30");
  D.addManual("2026-07-15", "元の項目", 30);
  const dump = D.exportData();
  eq(dump.startTime, "09:30");
  eq(dump.items.length, 1);
  // replace
  D.importData({ version: 1, startTime: "08:00", items: [{ id: "d_x", date: "2026-07-15", title: "置換後", minutes: 45, done: false, source: "manual", todoId: null }] }, "replace");
  eq(D.startTime(), "08:00");
  eq(D.items().map((it) => it.title), ["置換後"]);
  // merge（既存 d_x を上書き＋新規 d_y 追加）
  D.importData({ items: [{ id: "d_x", date: "2026-07-15", title: "上書き", minutes: 45, done: true, source: "manual", todoId: null }, { id: "d_y", date: "2026-07-15", title: "追加", minutes: 15, done: false, source: "manual", todoId: null }] }, "merge");
  const byId = {};
  D.items().forEach((it) => (byId[it.id] = it));
  eq(byId["d_x"].title, "上書き");
  eq(byId["d_y"].title, "追加");
});
