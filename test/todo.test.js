/* todo ロジック */
"use strict";

test("todo: 追加は inbox・件数・完了・フィルタ", (MK) => {
  const T = MK.logic.todo;
  T.addTask("買い物"); T.addTask("電話");
  eq(T.counts().inbox, 2);
  eq(T.counts().all, 2);
  const first = T.tasks()[0]; // unshift のため最後に追加した「電話」
  T.toggleDone(first.id, true);
  eq(T.counts().done, 1);
  eq(T.filtered("done", "").length, 1);
  eq(T.filtered("all", "買い").length, 1);
});
