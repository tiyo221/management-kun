/* todo ロジック */
"use strict";

test("todo: 追加は inbox・件数・完了・フィルタ", (MK) => {
  // 観点: 追加でカウント(inbox/all)が増え、完了トグルが done へ反映され、状態/キーワードでフィルタできる
  // 入力: "買い物","電話" を追加（unshift のため tasks()[0] は後発の「電話」）→ 先頭を完了
  // 期待: inbox=2 / all=2 / 完了後 done=1 / done フィルタ1件 / "買い"検索1件
  const T = MK.logic.todo;
  T.addTask("買い物"); T.addTask("電話");
  eq(T.counts().inbox, 2);
  eq(T.counts().all, 2);
  const first = T.tasks()[0];
  T.toggleDone(first.id, true);
  eq(T.counts().done, 1);
  eq(T.filtered("done", "").length, 1);
  eq(T.filtered("all", "買い").length, 1);
});

test("todo: CSV ラウンドトリップ（ステータス/プロジェクト名寄せ・全置換）", (MK) => {
  // 観点: buildCSVRows→applyCSV で往復でき、プロジェクトは名前で参照、ステータスは key/ラベル両対応
  const T = MK.logic.todo;
  const rows = [
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["企画書", "next", "新製品", "@pc @mail", "2026-07-10", "急ぎ"],
    ["買い物", "Inbox", "", "", "", ""],        // ラベル表記・プロジェクト空
    ["完了タスク", "Done", "新製品", "", "", ""], // ラベル表記 done
    ["", "next", "無視", "", "", ""],             // タイトル空はスキップ
  ];
  const r = T.applyCSV(rows);
  eq(r.ok, 3);
  eq(r.skip, 1);
  eq(T.counts().all, 3);
  const kikaku = T.tasks().find((t) => t.title === "企画書");
  eq(kikaku.status, "next");
  eq(kikaku.contexts, ["@pc", "@mail"]);
  eq(kikaku.due, "2026-07-10");
  eq(T.projectNameOf(kikaku.projectId), "新製品"); // 名寄せでマスタ作成
  const kanryo = T.tasks().find((t) => t.title === "完了タスク");
  eq(kanryo.status, "done");                       // ラベル「Done」→ done
  assert(kanryo.completedAt, "done は completedAt を持つ");
  const kaimono = T.tasks().find((t) => t.title === "買い物");
  eq(kaimono.projectId, null);                     // 空プロジェクトは未割当
  // 往復: 出力ヘッダと再取込で件数が一致
  const out = T.buildCSVRows();
  eq(out[0], ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"]);
  eq(T.applyCSV(out).ok, 3);
});
