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

test("daily: moveItem は端で何もせず、他日の項目が挟まっても同日内で入れ替わる", (MK) => {
  // 観点: 保存は全日ぶんのフラット配列1本なので、同日の隣接項目は配列上で離れて並びうる。
  //       同日内の並びだけを見て入れ替える必要がある（logic のコメントが主張する性質を固定する）。
  //       端（先頭を↑／末尾を↓）は範囲外なので何もしない。
  // 入力: 7/15 と 7/16 を交互に追加（X(16) A(15) Y(16) B(15) の順）
  // 期待: B を1つ前へ→7/15 は [B,A]、7/16 は [X,Y] のまま。端の移動は no-op
  const D = MK.logic.daily;
  const d1 = "2026-07-15", d2 = "2026-07-16";
  D.addManual(d2, "X", 30);
  const aId = D.addManual(d1, "A", 30);
  D.addManual(d2, "Y", 30);
  const bId = D.addManual(d1, "B", 30);
  eq(D.dayItems(d1).map((it) => it.title), ["A", "B"]);
  // 他日（X・Y）が配列上で挟まっていても、同日内で入れ替わる
  D.moveItem(bId, -1);
  eq(D.dayItems(d1).map((it) => it.title), ["B", "A"]);
  eq(D.dayItems(d2).map((it) => it.title), ["X", "Y"]); // 他日は巻き込まれない
  // 端は no-op（先頭を↑・末尾を↓）
  D.moveItem(bId, -1);
  eq(D.dayItems(d1).map((it) => it.title), ["B", "A"]);
  D.moveItem(aId, 1);
  eq(D.dayItems(d1).map((it) => it.title), ["B", "A"]);
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
  eq(D.pullableTodos().length, 2); // next のみ（inbox は対象外）
  const cand = D.pullableTodos().find((c) => c.title === "設計する");
  const itemId = D.pullFromTodo(day, cand.id, 30);
  assert(itemId, "引き込めた");
  eq(D.pullableTodos().length, 1);                 // 引いた分は候補から外れる
  eq(D.pullFromTodo(day, cand.id, 30), null);      // 同じ日への二重引き込みは不可
  // デイリーで完了 → todo も done
  D.toggleDone(itemId, true);
  eq(T.tasks().find((t) => t.title === "設計する").status, "done");
  // 解除 → todo は next へ戻る（再び引ける）
  D.toggleDone(itemId, false);
  eq(T.tasks().find((t) => t.title === "設計する").status, "next");
});

test("daily: 同じ todo は日をまたいで二重に引けない（完了済みなら再び引ける）", (MK) => {
  // 観点: 実体（todo）は1つなので、未完了のまま複数日に載ると完了同期が片方にしか効かず不整合になる。
  //       未完了で載っている間は他日でも候補から外す。完了＝todo が done になれば next でなくなり候補から消える。
  // 入力: next 1件を 7/15 へ引く → 7/16 へも引こうとする
  // 期待: 7/16 への引き込みは null（候補にも出ない）。7/15 の項目を消せば再び引ける
  const D = MK.logic.daily, T = MK.logic.todo;
  const d1 = "2026-07-15", d2 = "2026-07-16";
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["設計する", "next", "", "", "", ""],
  ]);
  const todoId = D.pullableTodos()[0].id;
  const itemId = D.pullFromTodo(d1, todoId, 30);
  assert(itemId, "7/15 へ引き込めた");
  eq(D.pullableTodos().length, 0);            // 未完了で載っている間は候補に出ない
  eq(D.pullFromTodo(d2, todoId, 30), null);   // 翌日への二重引き込みも不可
  eq(D.dayItems(d2).length, 0);
  // デイリーから外す（＝今日やらない）と、todo は next のまま残るので再び引ける
  D.removeItem(itemId);
  eq(D.pullableTodos().length, 1);
  assert(D.pullFromTodo(d2, todoId, 30), "外した後は別日へ引ける");
});

test("daily: todo 側で完了するとデイリーにも反映される（todo が正・繰り越されない）", (MK) => {
  // 観点: 実体は todo が持つので、ToDo 画面側で完了した項目はデイリーでも完了として扱う。
  //       反映されないと「今日の残り」に居座り、毎日翌日へ繰り越され続けて解消不能になる。
  // 入力: next を引いて 7/15 に載せる → todo 側で（デイリーを経由せず）完了させる
  // 期待: dayItems の done=true、summary の残り=0、rolloverTo が動かさない
  const D = MK.logic.daily, T = MK.logic.todo;
  const day = "2026-07-15";
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["設計する", "next", "", "", "", ""],
  ]);
  const todoId = D.pullableTodos()[0].id;
  D.pullFromTodo(day, todoId, 30);
  eq(D.dayItems(day)[0].done, false);
  eq(D.summary(day).stats[0], { label: "今日の残り", value: 1 });
  // ToDo 画面側で直接完了（デイリーを経由しない）
  T.toggleDone(todoId, true);
  eq(D.dayItems(day)[0].done, true);                            // todo の状態が正として解決される
  eq(D.summary(day).stats[0], { label: "今日の残り", value: 0 }); // 残りに数えない
  eq(D.rolloverTo(day, "2026-07-16"), 0);                        // 翌日へ送り続けない
  eq(D.dayItems(day).length, 1);                                 // その日に履歴として残る
  // todo 側で解除すれば再び未完として扱う
  T.toggleDone(todoId, false);
  eq(D.dayItems(day)[0].done, false);
});

test("daily: todo 側でタスク名を変えるとデイリーの表示も追従する（title も todo が正）", (MK) => {
  // 観点: done を todo から解決するのに title をスナップショットのまま据え置くと、ToDo で改名した
  //       瞬間にデイリーが旧名を永久表示し「実体は todo が持つ」の宣言と食い違う。title も解決する。
  // 入力: next「設計する」を引く → ToDo 側で「詳細設計をする」に改名
  // 期待: dayItems の title が追従。繰り越し（書き込み経路）で保存値も治癒し、todo 削除後も新名を保つ
  const D = MK.logic.daily, T = MK.logic.todo;
  const d1 = "2026-07-15", d2 = "2026-07-16";
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["設計する", "next", "", "", "", ""],
  ]);
  const todoId = D.pullableTodos()[0].id;
  D.pullFromTodo(d1, todoId, 30);
  eq(D.dayItems(d1)[0].title, "設計する");
  // ToDo 画面側で改名
  T.updateTask(todoId, { title: "詳細設計をする" });
  eq(D.dayItems(d1)[0].title, "詳細設計をする"); // 表示が追従する
  eq(D.items()[0].title, "設計する");            // 保存値（スナップショット）はまだ古い
  // 繰り越し（書き込み経路）で保存値も治癒する
  eq(D.rolloverTo(d1, d2), 1);
  eq(D.items()[0].title, "詳細設計をする");
  // todo 実体が消えてもスナップショットが新名なので旧名へ戻らない
  T.removeTask(todoId);
  eq(D.dayItems(d2)[0].title, "詳細設計をする");
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

test("daily: 取り残しをまとめて今日へ送る（staleCount / rolloverStaleTo）", (MK) => {
  // 観点: 締めを数日忘れると未処理が過去日に散らばる。HOME の要対応をクリックすると本日が開くので、
  //       日を遡らずまとめて拾い直せる必要がある。過去日の未完了だけを今日へ寄せ、完了と未来日は動かさない。
  // 入力: 7/12 に未完1・完了1、7/13 に未完2、今日 7/15 に既存1、未来 7/16 に1
  // 期待: staleCount=3、まとめ送りで3件が今日の末尾へ（既存の後ろに、元の配列順＝挿入順のまま付く）。
  //       完了と未来日はそのまま
  const D = MK.logic.daily;
  const today = "2026-07-15";
  D.addManual("2026-07-12", "12日の残り", 30);
  const doneId = D.addManual("2026-07-12", "12日に済んだ", 30);
  D.toggleDone(doneId, true);
  D.addManual("2026-07-13", "13日の残りA", 30);
  D.addManual("2026-07-13", "13日の残りB", 30);
  D.addManual(today, "今日の既存", 30);
  D.addManual("2026-07-16", "明日の予定", 30);
  eq(D.staleCount(today), 3);                       // 過去日の未完了のみ（完了は数えない）
  eq(D.rolloverStaleTo(today), 3);
  eq(D.staleCount(today), 0);
  // 今日は既存が先頭、拾い直した3件が後ろに元の配列順のまま付く
  eq(D.dayItems(today).map((it) => it.title), ["今日の既存", "12日の残り", "13日の残りA", "13日の残りB"]);
  eq(D.dayItems("2026-07-12").map((it) => it.title), ["12日に済んだ"]); // 完了は履歴として残る
  eq(D.dayItems("2026-07-16").map((it) => it.title), ["明日の予定"]);   // 未来日は動かさない
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

test("daily: 取り込みは不正な minutes / done / startTime を寛容に正規化する", (MK) => {
  // 観点: 外部 JSON（手書き・AI 生成もありうる）を寛容に受けて寄せる。minutes が 0/負/NaN/欠落でも
  //       正の整数へ、done は真偽値へ、startTime は不正なら既定へ寄せて時間割が壊れないようにする。
  // 入力: minutes=0 / -5 / "abc" / 欠落、done="yes"、startTime="99:99"
  // 期待: minutes は既定 30 へ、done は true へ、startTime は既定 09:00 へ。schedule が成立する
  const D = MK.logic.daily;
  const it = (id, minutes, done) => ({ id, date: "2026-07-15", title: id, minutes, done, source: "manual", todoId: null });
  D.importData({ version: 1, startTime: "99:99", items: [
    it("d_1", 0, false), it("d_2", -5, false), it("d_3", "abc", "yes"), { id: "d_4", date: "2026-07-15", title: "d_4", source: "manual", todoId: null },
  ] }, "replace");
  eq(D.startTime(), "09:00");                                  // 不正な開始時刻は既定へ
  eq(D.items().map((x) => x.minutes), [30, 30, 30, 30]);       // 0/負/NaN/欠落 → 既定 30
  eq(D.items().find((x) => x.id === "d_3").done, true);        // "yes" → true
  const s = D.schedule("2026-07-15");
  eq(s.endLabel, "11:00");                                     // 30分×4＝2時間、09:00 起点
  eq(s.overflow, false);
});

test("daily: 取り込みは id 欠落を採番し、不正な date は当日へ寄せる", (MK) => {
  // 観点: id 欠落を許すと mergeById が byId[undefined] へ集約して取りこぼし、id 一致で引く
  //       moveItem/removeItem/toggleDone も誤ヒットする。date 欠落はどの日にも属さない幽霊項目になる。
  // 入力: replace で id なし2件（うち1件は date 欠落・1件は不正 date）、merge で id なし1件を追加
  // 期待: replace で2件とも生き残り（採番されて別 id）、date は当日へ。merge でも潰し合わずに増える
  const D = MK.logic.daily;
  const today = MK.util.todayISO();
  D.importData({ version: 1, items: [
    { title: "id なし1", minutes: 30, source: "manual", todoId: null },              // id・date 欠落
    { title: "id なし2", date: "2026/07/15", minutes: 30, source: "manual", todoId: null }, // 不正 date 形式
  ] }, "replace");
  eq(D.items().length, 2);                                       // どちらも消えない（byId[undefined] に潰されない）
  const ids = D.items().map((x) => x.id);
  assert(ids[0] && ids[1] && ids[0] !== ids[1], "id が採番され重複しない");
  eq(D.items().map((x) => x.date), [today, today]);               // 欠落・不正 date は当日へ
  eq(D.dayItems(today).length, 2);                               // 画面（日の器）から到達できる
  // merge でも id なしが既存を潰さない
  D.importData({ items: [{ title: "id なし3", minutes: 30, source: "manual", todoId: null }] }, "merge");
  eq(D.items().length, 3);
  eq(D.dayItems(today).map((x) => x.title), ["id なし1", "id なし2", "id なし3"]);
});

test("daily: 取り込みは暦として存在しない date を当日へ寄せ、source/todoId を整える", (MK) => {
  // 観点: 書式が合っていても暦にない日（2026-02-31）は addDays が生成せず、どの日の器からも
  //       到達できない幽霊項目になる。source 未知値は手書きへ寄せ、手書きに todoId を残さない。
  // 入力: date="2026-02-31"（2月31日）/ "2026-13-01"（13月）、source="bogus" かつ todoId 付き
  // 期待: date は当日へ、source="manual"、todoId=null。実在する 2026-02-28 はそのまま通す
  const D = MK.logic.daily;
  const today = MK.util.todayISO();
  D.importData({ version: 1, items: [
    { id: "d_1", date: "2026-02-31", title: "存在しない日", minutes: 30, source: "manual", todoId: null },
    { id: "d_2", date: "2026-13-01", title: "13月", minutes: 30, source: "manual", todoId: null },
    { id: "d_3", date: "2026-02-28", title: "実在する日", minutes: 30, source: "bogus", todoId: "t_x" },
  ] }, "replace");
  const byId = {};
  D.items().forEach((x) => (byId[x.id] = x));
  eq(byId["d_1"].date, today);          // 2月31日 → 当日へ
  eq(byId["d_2"].date, today);          // 13月 → 当日へ
  eq(byId["d_3"].date, "2026-02-28");   // 実在する日はそのまま
  eq(byId["d_3"].source, "manual");     // 未知の source は手書きへ
  eq(byId["d_3"].todoId, null);         // 手書きに todoId を残さない
  eq(D.dayItems(today).length, 2);      // 幽霊項目にならず日の器から到達できる
});

test("daily: 繰り越しがスナップショットを治癒する（todo 実体の削除後に復活しない）", (MK) => {
  // 観点: 読み取り時の resolveDone は表示を揃えるだけで保存値は古いまま。書き込み経路である
  //       rolloverTo で解決値へ書き戻さないと、todo 側完了 → todo 削除 の順で古い false を
  //       フォールバックが拾い、完了済み項目が未完了として復活して毎日繰り越され始める。
  // 入力: next を引いて 7/15 に載せる → ToDo 側で完了 → 締め（rolloverTo）→ todo を削除
  // 期待: 締めで保存値が done=true に治癒し、todo 削除後も完了のまま（繰り越されない）
  const D = MK.logic.daily, T = MK.logic.todo;
  const d1 = "2026-07-15", d2 = "2026-07-16";
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["設計する", "next", "", "", "", ""],
  ]);
  const todoId = D.pullableTodos()[0].id;
  D.pullFromTodo(d1, todoId, 30);
  eq(D.items()[0].done, false);        // 保存値は未完
  T.toggleDone(todoId, true);          // ToDo 画面側で完了（デイリーを経由しない）
  eq(D.items()[0].done, false);        // 保存値はまだ古い（解決は読み取り時のみ）
  eq(D.rolloverTo(d1, d2), 0);         // 締め: 完了済みなので繰り越さない
  eq(D.items()[0].done, true);         // 保存値が解決値へ治癒した
  // todo 実体が消えてもフォールバックが完了を保つ（未完了として復活しない）
  T.removeTask(todoId);
  eq(D.dayItems(d1)[0].done, true);
  eq(D.rolloverTo(d1, d2), 0);         // 復活して毎日繰り越され始めない
  eq(D.dayItems(d2).length, 0);
});

test("daily: replace で startTime 欠落なら現状維持（設定を黙って失わない）", (MK) => {
  // 観点: replace が置き換えるのは items。開始起点は利用者の設定なので、取り込みデータに
  //       妥当な値が無ければ現状維持に倒す（merge との非対称を作らない）。
  // 入力: 10:30 を設定 → startTime を持たない JSON を replace → 妥当な値を持つ JSON を replace
  // 期待: 欠落時は 10:30 のまま、妥当値なら採用
  const D = MK.logic.daily;
  D.setStartTime("10:30");
  D.importData({ version: 1, items: [] }, "replace");
  eq(D.startTime(), "10:30"); // 欠落で現状維持（既定 09:00 へ戻さない）
  D.importData({ version: 1, startTime: "07:45", items: [] }, "replace");
  eq(D.startTime(), "07:45"); // 妥当値は採用
});

test("daily: 取り込みは id 重複を再採番する（replace でも一意を保証）", (MK) => {
  // 観点: id 欠落だけでなく重複も潰さないと、id 一致で引く moveItem/removeItem/toggleDone が
  //       先頭にしかヒットせず「2行目を編集すると1行目が変わる」「1行消すと2行消える」になる。
  //       merge は mergeById が畳むので、replace 経路にも同じ保証を与える。
  // 入力: 同じ id "d_x" を持つ2件を replace
  // 期待: 2件とも残り id は一意。2件目の編集が1件目に影響せず、1件削除で1件残る
  const D = MK.logic.daily;
  const day = "2026-07-15";
  const it = (id, title, minutes) => ({ id, date: day, title, minutes, done: false, source: "manual", todoId: null });
  D.importData({ version: 1, items: [it("d_x", "一件目", 90), it("d_x", "二件目", 60)] }, "replace");
  eq(D.items().length, 2);
  const ids = D.items().map((x) => x.id);
  assert(ids[0] !== ids[1], "id が一意になる");
  // 2件目だけを編集しても1件目は変わらない
  const second = D.dayItems(day)[1];
  D.setMinutes(second.id, 15);
  eq(D.dayItems(day).map((x) => [x.title, x.minutes]), [["一件目", 90], ["二件目", 15]]);
  // 1件削除で1件だけ消える
  D.removeItem(second.id);
  eq(D.dayItems(day).map((x) => x.title), ["一件目"]);
});

test("daily: 同日への繰り越しは no-op（順序を黙って変えない）", (MK) => {
  // 観点: rolloverTo(d, d) を許すと、その日の未完了だけが末尾へ寄って時間割の順序が黙って変わる。
  // 入力: 7/15 に 未完A・完了B・未完C（この順）→ 同日へ繰り越し
  // 期待: 0 件・並び順そのまま
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.addManual(day, "A", 30);
  const bId = D.addManual(day, "B", 30);
  D.addManual(day, "C", 30);
  D.toggleDone(bId, true);
  eq(D.rolloverTo(day, day), 0);
  eq(D.dayItems(day).map((it) => it.title), ["A", "B", "C"]); // 並び替わらない
});

test("daily: 取り込みは数値 id を文字列へ寄せる（merge で朝イチへ飛ばさない）", (MK) => {
  // 観点: 数値 id を残すと mergeById の Object.keys が整数風キーを先頭に列挙するため、
  //       merge 取込でその項目がその日の先頭へ移動する。配列順＝時刻なので予定が黙って
  //       朝イチへ繰り上がってしまう。typedef も id は string。
  // 入力: 文字列 id の既存2件がある状態へ、数値 id 1 の項目を merge
  // 期待: id は文字列。既存の並び（時刻）が保たれ、後から入れた項目は末尾に付く
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.importData({ version: 1, items: [
    { id: "d_a", date: day, title: "朝の会議", minutes: 30, source: "manual", todoId: null },
    { id: "d_b", date: day, title: "昼の作業", minutes: 30, source: "manual", todoId: null },
  ] }, "replace");
  D.importData({ items: [{ id: 1, date: day, title: "数値idの項目", minutes: 30, source: "manual", todoId: null }] }, "merge");
  const added = D.items().find((x) => x.title === "数値idの項目");
  eq(typeof added.id, "string");                       // 文字列へ寄せる
  eq(D.dayItems(day).map((x) => x.title), ["朝の会議", "昼の作業", "数値idの項目"]); // 先頭へ飛ばない
});

test("daily: 日またぎ警告は未完了が残っているときだけ出す", (MK) => {
  // 観点: 時間割の合計・終了時刻は1日の計画として完了分も含むが、全部終わった夜まで
  //       「日をまたぎます」と警告し続けるのは行動につながらないノイズ。
  // 入力: 23:00 起点で 120分（終了 25:00＝はみ出し）。未完のうちは警告、完了させたら消える
  // 期待: 未完時は attention にあり、完了後は消える（endLabel/overflow 自体は変わらない）
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.setStartTime("23:00");
  const id = D.addManual(day, "夜作業", 120);
  assert(D.summary(day).attention.some((a) => a.label === "今日の予定が日をまたぎます"), "未完のうちは警告する");
  D.toggleDone(id, true);
  eq(D.schedule(day).overflow, true); // 時間割としてのはみ出し自体は変わらない
  assert(!D.summary(day).attention.some((a) => a.label === "今日の予定が日をまたぎます"), "全部終わったら警告しない");
});

test("daily: 取り込みは createdAt / updatedAt を補完する", (MK) => {
  // 観点: typedef と spec が必須と宣言しているので、取り込みデータに無くても欠落させない。
  // 入力: createdAt/updatedAt を持たない項目、および既存値を持つ項目
  // 期待: 欠落は取込時刻で補完、既存値は保持
  const D = MK.logic.daily;
  D.importData({ version: 1, items: [
    { id: "d_1", date: "2026-07-15", title: "欠落", minutes: 30, source: "manual", todoId: null },
    { id: "d_2", date: "2026-07-15", title: "既存", minutes: 30, source: "manual", todoId: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
  ] }, "replace");
  const byId = {};
  D.items().forEach((x) => (byId[x.id] = x));
  assert(byId["d_1"].createdAt && byId["d_1"].updatedAt, "欠落は補完する");
  eq(byId["d_2"].createdAt, "2026-01-01T00:00:00.000Z"); // 既存値は保持
  eq(byId["d_2"].updatedAt, "2026-01-02T00:00:00.000Z");
});

test("daily: merge の不正な startTime は現状維持（既定へ書き戻さない）", (MK) => {
  // 観点: 取り込みデータの startTime が不正なとき、設定済みの開始起点を既定 09:00 へ
  //       黙って戻さない（現状維持が期待動作）。妥当な値なら採用する。
  // 入力: 10:30 を設定 → merge で startTime="99:99" → merge で startTime="08:15"
  // 期待: 不正時は 10:30 のまま、妥当時は 08:15 を採用
  const D = MK.logic.daily;
  D.setStartTime("10:30");
  D.importData({ items: [], startTime: "99:99" }, "merge");
  eq(D.startTime(), "10:30"); // 不正値で現状維持
  D.importData({ items: [], startTime: "08:15" }, "merge");
  eq(D.startTime(), "08:15"); // 妥当値は採用
});

test("daily: overflow はちょうど 24:00 では立たず、超過で立つ", (MK) => {
  // 観点: 24:00 ちょうどに終わるのは「日をまたいで」いないので警告しない（境界値）。
  // 入力: 23:00 起点で 60分 → ちょうど 24:00。さらに 15分 足すと超過
  // 期待: 60分では overflow=false（終了 24:00）、75分では overflow=true（終了 24:15）
  const D = MK.logic.daily;
  const day = "2026-07-15";
  D.setStartTime("23:00");
  const id = D.addManual(day, "夜作業", 60);
  eq(D.schedule(day).endLabel, "24:00");
  eq(D.schedule(day).overflow, false); // ちょうど 24:00 はまたいでいない
  D.setMinutes(id, 15);
  D.addManual(day, "追加作業", 60);
  eq(D.schedule(day).endLabel, "24:15");
  eq(D.schedule(day).overflow, true);
});
