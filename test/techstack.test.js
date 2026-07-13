/* techstack ロジック */
"use strict";

test("techstack: 追加は assess・件数・検索・タグ検索", (MK) => {
  // 観点: 追加で ring=assess/all が増え、名前/タグで検索できる
  // 入力: 2件追加（unshift のため items()[0] は後発）、片方にカテゴリ/タグ付与して検索
  // 期待: assess=all=2、タグ・名前・カテゴリ各1件命中、空の技術名は追加されず all=2 のまま
  const T = MK.logic.techstack;
  T.addItem("React");
  T.addItem("PostgreSQL");
  eq(T.counts().assess, 2);
  eq(T.counts().all, 2);
  const first = T.items()[0]; // PostgreSQL
  T.updateItem(first.id, { category: "DB", tags: ["infra"] });
  eq(T.filtered("all", "all", "infra").length, 1);
  eq(T.filtered("all", "all", "react").length, 1);
  eq(T.filtered("all", "DB", "").length, 1);
  // 空の技術名は追加されない
  T.addItem("   ");
  eq(T.counts().all, 2);
});

test("techstack: ring 遷移と正規化", (MK) => {
  // 観点: updateItem で ring を変更でき、未知値は assess に寄る
  // 入力: 1件追加→updateItem で ring="hold"→ring="bogus"
  // 期待: hold に変わり counts().hold=1、未知値 "bogus" は assess に正規化される
  const T = MK.logic.techstack;
  T.addItem("jQuery");
  const it = T.items()[0];
  T.updateItem(it.id, { ring: "hold" });
  eq(T.items()[0].ring, "hold");
  eq(T.counts().hold, 1);
  T.updateItem(it.id, { ring: "bogus" });
  eq(T.items()[0].ring, "assess");
});

test("techstack: categories は出現順・重複なし・空除外", (MK) => {
  // 観点: categories() が出現順で一意、空カテゴリは含めない
  // 入力: 3件に category を「言語」「DB」「言語」と付与（items() は追加逆順 [C,B,A]）
  // 期待: categories() は出現順で重複を畳んだ ["言語","DB"]（空カテゴリは含めない）
  const T = MK.logic.techstack;
  T.addItem("A"); T.addItem("B"); T.addItem("C");
  const list = T.items(); // [C, B, A]
  T.updateItem(list[0].id, { category: "言語" });   // C
  T.updateItem(list[1].id, { category: "DB" });     // B
  T.updateItem(list[2].id, { category: "言語" });   // A（空のまま→言語）
  eq(T.categories(), ["言語", "DB"]);
});

test("techstack: summary は技術件数と Hold 件数", (MK) => {
  // 観点: summary.stats[0]=技術総数, stats[1]=Hold 件数
  // 入力: 2件追加し、1件を ring="hold" にする
  // 期待: empty=false、stats[0].value=2（総数）、stats[1].value=1（Hold 件数）
  const T = MK.logic.techstack;
  T.addItem("X"); T.addItem("Y");
  T.updateItem(T.items()[0].id, { ring: "hold" });
  const s = T.summary();
  eq(s.empty, false);
  eq(s.stats[0].value, 2);
  eq(s.stats[1].value, 1);
});

test("techstack: CSV 出力・取込（ラベル/キー・タグ分割）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・ラベル/キー両対応・タグ空白区切り
  // 入力: 3行（React=adopt・タグ2つ／jQuery=ラベル「保留」・不正な見直し期限／技術名空）を applyCSV
  // 期待: 取込2件（名前空スキップ）。タグは空白分割、「保留」→hold、不正日付→""、出力ヘッダは既定列順
  const T = MK.logic.techstack;
  const rows = [
    ["技術名", "カテゴリ", "バージョン", "リング", "メモ", "見直し期限", "タグ"],
    ["React", "フロント", "18", "adopt", "標準", "2027-01-01", "web ui"],
    ["jQuery", "フロント", "3", "保留", "撤去予定", "不正", "legacy"],
    ["", "空行", "", "adopt", "", "", ""], // 技術名なしはスキップ
  ];
  const n = T.applyCSV(rows);
  eq(n, 2);
  eq(T.counts().all, 2);
  const react = T.items().find((x) => x.name === "React");
  eq(react.ring, "adopt");
  eq(react.reviewDate, "2027-01-01");
  eq(react.tags, ["web", "ui"]);
  const jq = T.items().find((x) => x.name === "jQuery");
  eq(jq.ring, "hold"); // 日本語ラベル「保留」→ hold
  eq(jq.reviewDate, ""); // 不正な日付は "" に正規化
  // 出力ヘッダ
  eq(T.buildCSVRows()[0], ["技術名", "カテゴリ", "バージョン", "リング", "メモ", "見直し期限", "タグ"]);
});

test("techstack: deadlineStatus は none/overdue/soon/ok を判定", (MK) => {
  // 観点: 基準日 today からの残日数で状態を判定（閾値 90 日）
  // 入力: today=2026-07-05 に対し空/null/昨日/当日/90日後/91日後/不正日付を渡す
  // 期待: 空・null・不正=none、昨日=overdue、当日と90日後=soon（境界内）、91日後=ok
  const T = MK.logic.techstack;
  const today = "2026-07-05";
  eq(T.deadlineStatus("", today), "none");
  eq(T.deadlineStatus(null, today), "none");
  eq(T.deadlineStatus("2026-07-04", today), "overdue"); // 昨日
  eq(T.deadlineStatus("2026-07-05", today), "soon");     // 当日（残0）
  eq(T.deadlineStatus("2026-10-03", today), "soon");     // 90日後（境界）
  eq(T.deadlineStatus("2026-10-04", today), "ok");       // 91日後
  eq(T.deadlineStatus("不正な日付", today), "none");     // 形式不正は none
});

test("techstack: deadlineCounts と summary の期限接近/超過", (MK) => {
  // 観点: 接近・超過の件数を集計し summary の stats[2] に反映する
  // 入力: today=2026-07-05 に対し reviewDate=過去/90日以内/遠未来/未設定 の4件
  // 期待: deadlineCounts は overdue=1・soon=1、summary の stats[2].label="期限 接近/超過"
  const T = MK.logic.techstack;
  const today = "2026-07-05";
  T.addItem("超過");   T.updateItem(T.items()[0].id, { reviewDate: "2026-01-01" });
  T.addItem("接近");   T.updateItem(T.items()[0].id, { reviewDate: "2026-08-01" });
  T.addItem("余裕");   T.updateItem(T.items()[0].id, { reviewDate: "2030-01-01" });
  T.addItem("未設定"); // reviewDate ""
  const dc = T.deadlineCounts(today);
  eq(dc.overdue, 1);
  eq(dc.soon, 1);
  const s = T.summary();
  eq(s.stats[2].label, "期限 接近/超過");
});

test("techstack: 不正な reviewDate は updateItem で '' に正規化", (MK) => {
  // 観点: updateItem 経由の reviewDate も normalizeDate を通す
  // 入力: 1件に updateItem で reviewDate="2026/07/05"（スラッシュ＝不正）→"2026-07-05"（正）
  // 期待: 不正形式は "" に、正しい ISO 日付はそのまま保持される
  const T = MK.logic.techstack;
  T.addItem("X");
  const id = T.items()[0].id;
  T.updateItem(id, { reviewDate: "2026/07/05" }); // スラッシュ区切りは不正
  eq(T.items()[0].reviewDate, "");
  T.updateItem(id, { reviewDate: "2026-07-05" });
  eq(T.items()[0].reviewDate, "2026-07-05");
});

test("techstack: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  // 入力: 既存A を作り、merge で {既存A の id→上書きA, 新規B}／その後 replace で {置換のみ1件}
  // 期待: merge 後は2件（既存A が「上書きA」に）、replace 後は1件だけ残る
  const T = MK.logic.techstack;
  T.addItem("既存A");
  const a = T.items()[0];
  T.importData({ items: [{ id: a.id, name: "上書きA", ring: "adopt", tags: [] }, { id: "ts_x", name: "新規B", ring: "trial", tags: [] }] }, "merge");
  eq(T.counts().all, 2);
  eq(T.items().find((x) => x.id === a.id).name, "上書きA");
  T.importData({ items: [{ id: "ts_y", name: "置換のみ", ring: "adopt", tags: [] }] }, "replace");
  eq(T.counts().all, 1);
});
