/* oneonone ロジック */
"use strict";

test("oneonone: エントリ追加は memberId 必須・先頭挿入・アクション正規化", (MK) => {
  // 観点: memberId なしは追加されない。追加は unshift。空 text のアクションは除外され id が付く。
  // 入力: memberId 無しのエントリ、次に memberId=m1・actions=[{text:"やること"},{text:"  "}] のエントリ
  // 期待: 前者は null で件数0、後者は追加され id="o…"、空 text は除外され残1件（id="a…"/done=false/due=null）
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
  // 入力: m1 に 6/1・7/1、m2 に 7/2 のエントリを追加し entriesOf("m1")
  // 期待: m1 の2件のみ・先頭が 7/1（降順）。lastDateOf は m1→"2026-07-01"、未知 m9→null
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
  // 入力: actions=[A(未完), B(done:true)] のエントリを作り、A を toggleAction で2回反転
  // 期待: 初期の未完は1件。A を done にすると0件、もう一度 toggle で1件に戻る
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
  // 入力: body="old" のエントリを updateEntry で body/mood/actions=[{X},{空}] に更新後、removeEntry
  // 期待: body="new"・mood="good"、空 text 除外で actions1件。削除後は件数0
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
  // 入力: 空の状態と、未完アクション1つを含む記録＋アクションなし記録の計2件
  // 期待: 空は empty=true。2件時は empty=false・stats[0].value=1（未完）・stats[1].value=2（記録数）
  const O = MK.logic.oneonone;
  eq(O.summary().empty, true);
  O.addEntry({ memberId: "m1", date: "2026-07-01", body: "b", actions: [{ text: "A" }] });
  O.addEntry({ memberId: "m2", date: "2026-07-02", body: "b2" });
  const s = O.summary();
  eq(s.empty, false);
  eq(s.stats[0].value, 1); // 未完アクション
  eq(s.stats[1].value, 2); // 記録数
});

test("oneonone: CSV ラウンドトリップ（メンバー名寄せ・温度感・アクション複数行）", (MK) => {
  // 観点: buildCSVRows→applyCSV で往復でき、メンバーは名前で名寄せ、温度感は key/ラベル両対応、
  //       アクションは1セル複数行（状態|期限|やること）で復元、メンバー空はスキップ
  // 入力: 3行（佐藤=good・アクション2行／鈴木="😐 normal"・不正日付／メンバー空）を applyCSV し、出力を再取込
  // 期待: ok=2/skip=1。佐藤は People 作成・mood=good・アクション2件を状態/期限/text へ分解し id 再採番、
  //       鈴木はラベル→mood=normal・不正日付→今日。往復でヘッダ一致・再取込 ok=2
  const O = MK.logic.oneonone;
  const rows = [
    ["メンバー", "実施日", "話したこと", "温度感", "アクション"],
    ["佐藤 花子", "2026-07-01", "稼働の相談", "good", "done|2026-07-10|レビュー当番表を作る\ntodo||隔週に変更"],
    ["鈴木 一郎", "不正日付", "キャリア面談", "😐 normal", "todo|2026-07-20|スキルマップ整理"],
    ["", "2026-07-02", "メンバー空はスキップ", "bad", ""],
  ];
  const r = O.applyCSV(rows);
  eq(r.ok, 2);
  eq(r.skip, 1);
  eq(O.entries().length, 2);
  const sato = O.entries().find((e) => e.body === "稼働の相談");
  eq(MK.people.get(sato.memberId).name, "佐藤 花子"); // 名寄せでマスタ作成
  eq(sato.mood, "good");
  eq(sato.date, "2026-07-01");
  eq(sato.actions.length, 2);
  eq(sato.actions[0].done, true);
  eq(sato.actions[0].due, "2026-07-10");
  eq(sato.actions[0].text, "レビュー当番表を作る");
  eq(sato.actions[1].done, false);
  eq(sato.actions[1].due, null);
  assert(sato.actions[0].id[0] === "a", "アクション id は再採番される");
  const suzuki = O.entries().find((e) => e.body === "キャリア面談");
  eq(suzuki.mood, "normal"); // ラベル「😐 normal」→ normal
  eq(suzuki.date, MK.util.todayISO()); // 不正日付は取込日
  // 往復: 出力ヘッダと再取込で件数一致
  const out = O.buildCSVRows();
  eq(out[0], ["メンバー", "実施日", "話したこと", "温度感", "アクション"]);
  eq(O.applyCSV(out).ok, 2);
});

test("oneonone: parseActionsCell は区切り不足に寛容・空 text を除外", (MK) => {
  // 観点: `状態|期限|やること`（3項）/ `状態|やること`（2項）/ `やること`（1項）を解釈、空行は除外
  // 入力: 4行のセル "done|2026-07-01|三項" / "todo|二項だが期限なし" / "一項だけ" / 空白のみ
  // 期待: 3件（空行除外）。3項=done+期限+text、2項=状態+text（期限なし）、1項=text のみ（done=false/due=null）
  const O = MK.logic.oneonone;
  const acts = O.parseActionsCell("done|2026-07-01|三項\ntodo|二項だが期限なし\n一項だけ\n   ");
  eq(acts.length, 3);
  eq(acts[0].done, true); eq(acts[0].due, "2026-07-01"); eq(acts[0].text, "三項");
  eq(acts[1].done, false); eq(acts[1].text, "二項だが期限なし");
  eq(acts[2].done, false); eq(acts[2].due, null); eq(acts[2].text, "一項だけ");
});

test("oneonone: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  // 入力: 既存A を作り、merge で {既存A の id→上書きA, 新規B}／その後 replace で {置換のみ1件}
  // 期待: merge 後は2件（既存A が「上書きA」に）、replace 後は1件だけ残る
  const O = MK.logic.oneonone;
  const a = O.addEntry({ memberId: "m1", date: "2026-07-01", body: "既存A" });
  O.importData({ entries: [{ id: a.id, memberId: "m1", date: "2026-07-01", body: "上書きA", actions: [] }, { id: "o_x", memberId: "m2", date: "2026-07-03", body: "新規B", actions: [] }] }, "merge");
  eq(O.entries().length, 2);
  eq(O.entries().find((x) => x.id === a.id).body, "上書きA");
  O.importData({ entries: [{ id: "o_y", memberId: "m3", date: "2026-07-04", body: "置換のみ", actions: [] }] }, "replace");
  eq(O.entries().length, 1);
});
