/* goals ロジック */
"use strict";

test("goals: 進捗・いまここ・全完了で達成", (MK) => {
  const G = MK.logic.goals;
  const gid = G.addGoal("目標");
  G.addStep(gid, "s1"); G.addStep(gid, "s2");
  let g = G.getGoal(gid);
  eq(G.progress(g).pct, 0);
  eq(G.currentStepId(g), g.steps[0].id);

  G.toggleStep(gid, g.steps[0].id, true);
  g = G.getGoal(gid);
  eq(G.progress(g).done, 1);
  eq(G.currentStepId(g), g.steps[1].id); // 先頭の未完了

  G.toggleStep(gid, g.steps[1].id, true);
  g = G.getGoal(gid);
  assert(G.isAchieved(g), "全完了で達成");
  assert(!!g.achievedAt, "達成日が記録される");
});
