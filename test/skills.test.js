/* skills ロジック（平均・ギャップ・紐づけCSVラウンドトリップ） */
"use strict";

test("skills: 平均レベルとギャップ判定", (MK) => {
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "I", core: true, targetLevel: 3, requiredCount: 2 });
  const sid = S.skills()[0].id;
  const a = MK.people.resolveOrCreate("A"), b = MK.people.resolveOrCreate("B"), c = MK.people.resolveOrCreate("C");
  S.setRating(a, sid, "4"); S.setRating(b, sid, "3"); S.setRating(c, sid, "2");
  almost(S.avgLevel(sid), 3); // (4+3+2)/3
  const g = S.gapOf(S.skills()[0]); // target3/required2 → 充足=A,B=2 → ok
  eq(g.state, "ok");
  eq(g.sufficient, 2);
});

test("skills: 目標未設定のコアは unset", (MK) => {
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "J", core: true });
  eq(S.gapOf(S.skills()[0]).state, "unset");
});

test("skills: 紐づけCSV ラウンドトリップ（名前参照）", (MK) => {
  const S = MK.logic.skills;
  S.addSkill({ domain: "Web", item: "BE" });
  const sid = S.skills()[0].id;
  const a = MK.people.resolveOrCreate("佐藤 花子");
  S.setRating(a, sid, "4");
  const rows = S.buildRatingsCSVRows();
  // 一旦クリアして CSV から復元
  S.setRating(a, sid, "");
  eq(S.rating(a, sid), "");
  const r = S.applyRatingsCSV(rows);
  eq(r.ok, 1);
  eq(S.rating(a, sid), "4");
});
