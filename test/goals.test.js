/* goals ロジック */
"use strict";

test("goals: CSV 出力・取込（種別フラット化・入れ子復元・ラウンドトリップ）", (MK) => {
  // 観点: buildCSVRows のヘッダ、種別列で goal/step をフラット化、applyCSV が入れ子を復元し全置換する
  // 入力: goal/step を交互に並べた行（日本語ラベル「完了」・不正完了日・空タイトル step を含む）
  // 期待: goal 2件へ復元、step は直前 goal に入れ子化、「完了」→done、不正完了日は取込時刻で補完、空タイトルはスキップ
  const G = MK.logic.goals;
  const rows = [
    ["種別", "タイトル", "説明", "期限", "状態", "完了日", "振り返り"],
    ["goal", "資格に合格", "半年で", "2026-12-31", "", "", ""],
    ["step", "参考書1周", "", "", "done", "2026-07-01", "量が多い"],
    ["step", "過去問", "", "", "完了", "不正日付", ""], // 日本語ラベル・不正完了日は取込時刻
    ["step", "本試験", "", "", "todo", "", ""],
    ["goal", "ランニング習慣化", "", "", "", "", ""],
    ["step", "シューズ購入", "", "", "done", "2026-07-02", ""],
    ["step", "", "空タイトルはスキップ", "", "todo", "", ""], // スキップ
    ["step", "親なしステップ", "", "", "todo", "", ""], // これは直前 goal に付く（親あり）
  ];
  const n = G.applyCSV(rows);
  eq(n, 2); // goal 2件
  const gs = G.goals();
  eq(gs.length, 2);
  const g1 = gs.find((x) => x.title === "資格に合格");
  eq(g1.deadline, "2026-12-31");
  eq(g1.steps.length, 3); // done/完了/todo（空タイトルは別 goal 側）
  eq(g1.steps[0].status, "done");
  eq(g1.steps[0].completedAt, "2026-07-01");
  eq(g1.steps[0].review, "量が多い");
  eq(g1.steps[1].status, "done"); // 日本語ラベル「完了」
  assert(g1.steps[1].completedAt, "不正完了日は取込時刻で補完"); // "" ではなく日付
  const g2 = gs.find((x) => x.title === "ランニング習慣化");
  eq(g2.steps.length, 2); // シューズ購入 + 親なしステップ（直前 goal に付く）、空タイトルはスキップ
  // 出力ヘッダ
  eq(G.buildCSVRows()[0], ["種別", "タイトル", "説明", "期限", "状態", "完了日", "振り返り"]);
});

test("goals: CSV 親 goal のない step 行はスキップ", (MK) => {
  // 観点: 先頭に goal がなく step から始まる場合、その step は親なしとしてスキップされる
  // 入力: step「孤児ステップ」→ goal「有効な目標」の順（先頭が step）
  // 期待: goal は1件だけ復元され、孤児 step は捨てられる（有効な目標の steps は 0 件）
  const G = MK.logic.goals;
  const n = G.applyCSV([
    ["種別", "タイトル", "説明", "期限", "状態", "完了日", "振り返り"],
    ["step", "孤児ステップ", "", "", "todo", "", ""],
    ["goal", "有効な目標", "", "", "", "", ""],
  ]);
  eq(n, 1);
  eq(G.goals()[0].steps.length, 0);
});

test("goals: 進捗・いまここ・全完了で達成", (MK) => {
  // 観点: ステップ完了に応じて進捗率・「いまここ(currentStep)」が更新され、全完了で達成扱い＆達成日が記録される
  // 入力: 目標1件＋ステップ2件を作り、s1→s2 の順に完了させていく
  // 期待:
  //   初期        → 進捗 0% / いまここ=s1（先頭の未完了）
  //   s1 完了後   → done=1 / いまここ=s2 へ前進
  //   s2 も完了後 → isAchieved=true / achievedAt が記録される
  const G = MK.logic.goals;
  const gid = G.addGoal("目標");
  G.addStep(gid, "s1"); G.addStep(gid, "s2");
  let g = G.getGoal(gid);
  eq(G.progress(g).pct, 0);
  eq(G.currentStepId(g), g.steps[0].id);

  G.toggleStep(gid, g.steps[0].id, true);
  g = G.getGoal(gid);
  eq(G.progress(g).done, 1);
  eq(G.currentStepId(g), g.steps[1].id);

  G.toggleStep(gid, g.steps[1].id, true);
  g = G.getGoal(gid);
  assert(G.isAchieved(g), "全完了で達成");
  assert(!!g.achievedAt, "達成日が記録される");
});

test("goals: 目標削除→undoDelete で元の位置へ戻る／他の変更で退避が破棄される", (MK) => {
  // 観点: 削除は「消した1件＋元の位置」を退避し、undoDelete が同じ位置へ戻す（末尾ではない）。
  //       退避は削除以外の変更（commit を通る保存）で捨てる（CONVENTIONS §2.5-3）
  // 入力: A/B/C を作成 → 真ん中の B を削除 → undoDelete。別ケースで削除後に目標追加 → undoDelete
  // 期待: 戻すと A/B/C の並び。追加を挟んだら false で B は戻らない
  const G = MK.logic.goals;
  ["A", "B", "C"].forEach((t) => G.addGoal(t));
  const b = G.goals()[1];
  eq(G.removeGoal(b.id), true);
  eq(G.goals().map((g) => g.title), ["A", "C"]);
  eq(G.undoDelete(), true);
  eq(G.goals().map((g) => g.title), ["A", "B", "C"]);
  eq(G.goals()[1].id, b.id); // 同じ id が戻る（作り直しではない）

  G.removeGoal(G.goals()[0].id);
  G.addGoal("割り込み");
  eq(G.undoDelete(), false);
  eq(G.goals().map((g) => g.title), ["B", "C", "割り込み"]);
});

test("goals: ステップ削除も undo できる（目標と退避枠を共有し、後勝ちになる）", (MK) => {
  // 観点: 退避は1枠（アクティブな undo は常に1つ）。ステップは所属目標と位置を覚えて戻す
  // 入力: 目標1件にステップ3件 → 真ん中を削除 → undoDelete。別ケースで目標削除の直後にステップ削除 → undoDelete
  // 期待: ステップが元の位置へ戻る。後勝ちでステップだけが戻り、先に消した目標は戻らない
  const G = MK.logic.goals;
  const gid = G.addGoal("目標");
  ["s1", "s2", "s3"].forEach((t) => G.addStep(gid, t));
  const s2 = G.getGoal(gid).steps[1];
  eq(G.removeStep(gid, s2.id), true);
  eq(G.getGoal(gid).steps.map((s) => s.title), ["s1", "s3"]);
  eq(G.undoDelete(), true);
  eq(G.getGoal(gid).steps.map((s) => s.title), ["s1", "s2", "s3"]);

  const other = G.addGoal("消される目標");
  G.removeGoal(other);
  G.removeStep(gid, G.getGoal(gid).steps[0].id); // 退避はこちらで上書きされる
  eq(G.undoDelete(), true);
  eq(G.getGoal(gid).steps.map((s) => s.title), ["s1", "s2", "s3"]);
  eq(G.goals().map((g) => g.title), ["目標"]); // 先に消した目標は戻らない（退避は1件だけ）
});

test("goals: 戻し先の目標が消えているステップは復元しない", (MK) => {
  // 観点: ステップの退避は所属目標を前提にする。目標ごと消えたあとに戻すと宙に浮くので false を返す
  //       （消えた目標ごと戻すのは undo の単位＝直前の1件を超える）
  // 入力: 目標＋ステップ → ステップ削除 → 目標削除 → undoDelete
  // 期待: 目標削除で退避は上書きされるため、undo が戻すのは目標（ステップは戻らない）
  const G = MK.logic.goals;
  const gid = G.addGoal("目標");
  G.addStep(gid, "s1");
  G.removeStep(gid, G.getGoal(gid).steps[0].id);
  G.removeGoal(gid);
  eq(G.undoDelete(), true);          // 直前の削除＝目標が戻る
  eq(G.goals().length, 1);
  eq(G.getGoal(G.goals()[0].id).steps.length, 0); // ステップは戻らない（退避は1件だけ）
});

test("goals: 空振り削除は false を返し、forgetUndo で退避が捨てられる", (MK) => {
  // 観点: 空振りでトーストを出すと、その取り消しが直前に消した別の1件を復元してしまう。
  //       forgetUndo は全データ初期化（MK.store.clearAll は commit を通らない）用の後始末
  // 入力: A を削除 → 存在しない id を削除 → undoDelete／別ケースで削除 → forgetUndo → undoDelete
  // 期待: 空振りは false で退避を潰さず A は戻る。forgetUndo 後は false
  const G = MK.logic.goals;
  const gid = G.addGoal("A");
  G.removeGoal(gid);
  eq(G.removeGoal("no-such-id"), false);
  eq(G.removeStep("no-such-goal", "no-such-step"), false);
  eq(G.undoDelete(), true);
  eq(G.goals().map((g) => g.title), ["A"]);

  G.removeGoal(G.goals()[0].id);
  G.forgetUndo();
  eq(G.undoDelete(), false);
  eq(G.goals().length, 0);
});
