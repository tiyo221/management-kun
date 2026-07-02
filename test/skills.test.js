/* skills ロジック（平均・ギャップ・紐づけCSVラウンドトリップ） */
"use strict";

test("skills: 平均レベルとギャップ判定", (MK) => {
  // 観点: スキルの平均レベルを算出し、目標レベル/必要人数に対する充足度(ギャップ)を判定する
  // 入力: 目標レベル3・必要人数2のコアスキルに、3人が 4/3/2 で評価
  // 期待: 平均=(4+3+2)/3=3 / 目標3以上はA,Bの2名 → 必要2を満たし state="ok"
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "I", core: true, targetLevel: 3, requiredCount: 2 });
  const sid = S.skills()[0].id;
  const a = MK.people.resolveOrCreate("A"), b = MK.people.resolveOrCreate("B"), c = MK.people.resolveOrCreate("C");
  S.setRating(a, sid, "4"); S.setRating(b, sid, "3"); S.setRating(c, sid, "2");
  almost(S.avgLevel(sid), 3);
  const g = S.gapOf(S.skills()[0]);
  eq(g.state, "ok");
  eq(g.sufficient, 2);
});

test("skills: 目標未設定のコアは unset", (MK) => {
  // 観点: コアなのに目標レベル/必要人数が未設定なら「未設定」として ok/gap と区別する（設定漏れの可視化）
  // 入力: core=true だが targetLevel/requiredCount を与えないスキル
  // 期待: gap.state="unset"
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "J", core: true });
  eq(S.gapOf(S.skills()[0]).state, "unset");
});

test("skills: 紐づけCSV ラウンドトリップ（名前参照）", (MK) => {
  // 観点: 評価CSVは人を「名前」で参照し、書き出し→取り込みで元の評価に戻せる（I/O回帰）
  // 入力: スキル1件に「佐藤 花子」の評価4 → CSV化 → 評価をクリア → applyRatingsCSV で復元
  // 期待: クリア後は空 / 取り込みで ok=1・評価が "4" に戻る
  const S = MK.logic.skills;
  S.addSkill({ domain: "Web", item: "BE" });
  const sid = S.skills()[0].id;
  const a = MK.people.resolveOrCreate("佐藤 花子");
  S.setRating(a, sid, "4");
  const rows = S.buildRatingsCSVRows();
  S.setRating(a, sid, "");
  eq(S.rating(a, sid), "");
  const r = S.applyRatingsCSV(rows);
  eq(r.ok, 1);
  eq(S.rating(a, sid), "4");
});
