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
