/* goals ロジック */
"use strict";

test("goals: CSV 出力・取込（種別フラット化・入れ子復元・ラウンドトリップ）", (MK) => {
  // 観点: buildCSVRows のヘッダ、種別列で goal/step をフラット化、applyCSV が入れ子を復元し全置換する
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
