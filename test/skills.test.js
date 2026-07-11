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

test("skills: radarData は軸＝表示スキル、値を軸順に並べ 未評価/対象外は 0", (MK) => {
  // 観点: レーダー用のデータ整形。軸は表示スキルのみ、値は軸順に整列し、未評価・"-" は 0 になる
  // 入力: 表示スキル2件＋非表示1件。Aは s1=4/s2="-"、Bは s1未評価/s2=3
  // 期待: axes は表示2件のみ / A.values=[4,0]・rated=1 / B.values=[0,3]・rated=1 / hasRating=true
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "S1" });
  S.addSkill({ domain: "D", item: "S2" });
  S.addSkill({ domain: "D", item: "Hidden", visible: false });
  const [s1, s2] = S.skills();
  const a = MK.people.resolveOrCreate("A"), b = MK.people.resolveOrCreate("B");
  S.setRating(a, s1.id, "4"); S.setRating(a, s2.id, "-");
  S.setRating(b, s2.id, "3");
  const d = S.radarData([a, b]);
  eq(d.axes.length, 2);
  eq(d.axes.map((x) => x.label), ["S1", "S2"]);
  eq(d.series[0].values, [4, 0]);
  eq(d.series[0].rated, 1);
  eq(d.series[1].values, [0, 3]);
  eq(d.series[1].rated, 1);
  eq(d.hasRating, true);
});

test("skills: radarData は評価ゼロ/存在しないメンバーを安全に扱う", (MK) => {
  // 観点: 評価が1件も無い・存在しないIDでも壊れず、空状態を判定できる（受け入れ条件: 少データで壊れない）
  // 入力: 表示スキル1件。評価なしのメンバー C と、存在しないID
  // 期待: 存在しないIDは series から除外 / C.rated=0 / hasRating=false
  const S = MK.logic.skills;
  S.addSkill({ domain: "D", item: "S1" });
  const c = MK.people.resolveOrCreate("C");
  const d = S.radarData([c, "no-such-id"]);
  eq(d.series.length, 1);
  eq(d.series[0].rated, 0);
  eq(d.hasRating, false);
});
