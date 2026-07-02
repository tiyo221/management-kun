/* goals ロジック */
"use strict";

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
