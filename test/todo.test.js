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

test("todo: setStatus は done で completedAt を打刻し done 以外で null に戻す", (MK) => {
  // 観点: ステータス変更の業務ルール（完了打刻）が logic に集約されている（view は打刻しない）
  // 入力: 追加→next 化して打刻が無いこと→done 化→再び waiting 化
  // 期待: next では completedAt=null、done で completedAt が入り、done 以外へ戻すと null に戻る
  const T = MK.logic.todo;
  T.addTask("設計する");
  const id = T.tasks()[0].id;
  T.setStatus(id, "next");
  eq(T.tasks()[0].completedAt, null);
  T.setStatus(id, "done");
  assert(T.tasks()[0].completedAt, "done は completedAt を持つ");
  eq(T.tasks()[0].status, "done");
  T.setStatus(id, "waiting");
  eq(T.tasks()[0].completedAt, null);
  eq(T.counts().done, 0);
});

test("todo: 削除の取り消し（元の位置へ復元・他の変更が入ると破棄）", (MK) => {
  // 観点: removeTask が「消した1件＋位置」を退避し、undoDelete で元の位置へ戻せる。
  //       別の変更（drop を呼ぶ操作）が入ると退避は破棄され、undoDelete は false を返す（CONVENTIONS §2.5-3）
  // 入力: A/B/C を投入（挿入順で並ぶ）→ 真ん中 B を削除 → undoDelete
  // 期待: 削除で all=2・並びは [A,C]、undoDelete=true で B が元の位置(中央)へ戻り [A,B,C]
  const T = MK.logic.todo;
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["A", "next", "", "", "", ""],
    ["B", "next", "", "", "", ""],
    ["C", "next", "", "", "", ""],
  ]);
  const titles = () => T.tasks().map((t) => t.title);
  const bId = T.tasks().find((t) => t.title === "B").id;
  T.removeTask(bId);
  eq(T.counts().all, 2);
  eq(titles(), ["A", "C"]);
  eq(T.undoDelete(), true);
  eq(titles(), ["A", "B", "C"]); // 中央の元位置へ戻る

  // 退避が無い状態での undoDelete は false（二重取り消しにならない）
  eq(T.undoDelete(), false);

  // 削除後に別の変更が入ると退避は破棄される
  const cId = T.tasks().find((t) => t.title === "C").id;
  T.removeTask(cId);
  T.addTask("D");          // drop を呼ぶ操作
  eq(T.undoDelete(), false); // 破棄済みなので戻せない
  assert(!titles().includes("C"), "破棄後は C が戻らない");
});

test("todo: filtered の並び替え（締め切り/プロジェクト/コンテキスト/既定）", (MK) => {
  // 観点: sort 引数で締め切り順(未設定は末尾)・プロジェクト別・コンテキスト別に並び、
  //       既定(created)は追加日順（挿入順＝新しい順）のまま
  // 入力: applyCSV で A(Alpha/@pc/7-20)・B(Beta/@mail/期限なし)・C(Alpha/@home/7-05) を行順投入
  // 期待: due→[C,A,B]（未設定 B は末尾）、project→[A,C,B]、context→[C,B,A]、created/既定→[A,B,C]（挿入順）
  const T = MK.logic.todo;
  // applyCSV で決め打ちのタスクを投入（unshift ではなく行順で入る）
  T.applyCSV([
    ["タイトル", "ステータス", "プロジェクト", "コンテキスト", "期限", "メモ"],
    ["A", "next", "Alpha", "@pc", "2026-07-20", ""],
    ["B", "next", "Beta", "@mail", "", ""],        // 期限なし → due 並びで末尾へ
    ["C", "next", "Alpha", "@home", "2026-07-05", ""],
  ]);
  const titles = (arr) => arr.map((t) => t.title);

  // 締め切り順: 昇順、未設定(B)は末尾
  eq(titles(T.filtered("all", "", "due")), ["C", "A", "B"]);

  // プロジェクト別: Alpha(A,C) が Beta(B) より先。同グループ内は挿入順を維持
  eq(titles(T.filtered("all", "", "project")), ["A", "C", "B"]);

  // コンテキスト別: @home(C) < @mail(B) < @pc(A)
  eq(titles(T.filtered("all", "", "context")), ["C", "B", "A"]);

  // 既定(created 相当)は絞り込み結果の順序（＝挿入順）をそのまま返す
  eq(titles(T.filtered("all", "", "created")), ["A", "B", "C"]);
  eq(titles(T.filtered("all", "")), ["A", "B", "C"]);
});

test("todo: CSV ラウンドトリップ（ステータス/プロジェクト名寄せ・全置換）", (MK) => {
  // 観点: buildCSVRows→applyCSV で往復でき、プロジェクトは名前で参照、ステータスは key/ラベル両対応
  // 入力: 4行（企画書=next・複数コンテキスト・PJ名／買い物=ラベル"Inbox"・PJ空／完了タスク=ラベル"Done"／タイトル空）を applyCSV し出力を再取込
  // 期待: ok=3/skip=1。コンテキストは空白分割、"Done"→done で completedAt 付与、PJ 名は Projects へ名寄せ、
  //       PJ 空は未割当(null)、往復でヘッダ一致・再取込 ok=3
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

test("todo: forgetUndo で退避が捨てられる（全データ初期化用）", (MK) => {
  // 観点: store を logic の外から消す経路（MK.store.clearAll）は save を通らないため、
  //       退避を明示的に捨てないと初期化後の Ctrl+Z で1件だけ復活する（CONVENTIONS §2.5-3）
  // 入力: 1件追加 → 削除 → forgetUndo() → undoDelete()
  // 期待: undoDelete は false を返し、件数は0のまま
  const L = MK.logic.todo;
  L.addTask("捨てる");
  L.removeTask(L.tasks()[0].id);
  L.forgetUndo();
  eq(L.undoDelete(), false);
  eq(L.tasks().length, 0);
});
