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

test("skills: updateSkill は更新できたかを返し、空振りでは保存しない", (MK) => {
  // 観点: 行内編集の確定を受け入れるか view が判断できること（removeSkill と同じ契約）。空振りで
  //       保存すると、別経路の変更を読み込み直した内容で巻き戻しかねない
  // 入力: 実在スキルの item を更新 → 存在しない id で更新 → 削除の直後に空振り更新して undoDelete
  // 期待: 実在は true で値が変わり、空振りは false で一覧は不変。空振りは save を通らないので
  //       直前の削除の退避も潰さない（save は pendingUndo を捨てるため、ここが「保存しない」の証拠）
  const S = MK.logic.skills;
  S.addSkill({ domain: "共通", item: "A" });
  S.addSkill({ domain: "共通", item: "B" });
  const a = S.skills()[0];
  eq(S.updateSkill(a.id, { item: "A2" }), true);
  eq(S.skills()[0].item, "A2");
  eq(S.updateSkill("no-such-id", { item: "X" }), false);
  eq(S.skills().map((s) => s.item).join(","), "A2,B");

  eq(S.removeSkill(S.skills()[0].id), true);
  eq(S.updateSkill("no-such-id", { item: "X" }), false);
  eq(S.undoDelete(), true);
  eq(S.skills().map((s) => s.item).join(","), "A2,B");
});

test("skills: 削除→undoDelete でスキルと評価が元に戻る", (MK) => {
  // 観点: スキル削除は紐づく評価（ratings）も消す。スキルだけ戻して評価が空だと、消したときより
  //       悪い状態（全メンバー分を入力し直し）になるので、退避に評価も含める（§2.5-3）
  // 入力: メンバー2人×スキル3件で評価を入れ、真ん中のスキルを削除 → undoDelete
  // 期待: 削除で該当スキルの評価が消え、undo でスキルが元の位置へ、評価も元の値へ戻る。
  //       他スキルの評価は巻き添えにならない
  const S = MK.logic.skills;
  const m1 = MK.people.create({ name: "山田" }), m2 = MK.people.create({ name: "佐藤" });
  ["A", "B", "C"].forEach((item) => S.addSkill({ domain: "共通", item }));
  const [a, b] = S.skills();
  S.setRating(m1.id, b.id, "3");
  S.setRating(m2.id, b.id, "5");
  S.setRating(m1.id, a.id, "2");

  eq(S.removeSkill(b.id), true);
  eq(S.skills().map((s) => s.item), ["A", "C"]);
  eq(S.rating(m1.id, b.id), ""); // 評価も消える
  eq(S.rating(m2.id, b.id), "");
  eq(S.rating(m1.id, a.id), "2"); // 他スキルの評価は無傷

  eq(S.undoDelete(), true);
  eq(S.skills().map((s) => s.item), ["A", "B", "C"]); // 元の位置へ
  eq(S.rating(m1.id, b.id), "3"); // 評価も元の値へ
  eq(S.rating(m2.id, b.id), "5");
});

test("skills: 退避は他の変更で破棄され、空振り削除は false を返す", (MK) => {
  // 観点: 削除以外の変更（追加・評価入力・全置換）で退避を捨てる。空振りでトーストを出すと、その
  //       取り消しが直前に消した別の1件を復元してしまう
  // 入力: 削除→スキル追加→undo／削除→評価入力→undo／削除→importData(replace)→undo／存在しない id の削除
  // 期待: いずれの undo も false。空振り削除は false を返し、直前の退避は潰さない
  const S = MK.logic.skills;
  const m = MK.people.create({ name: "山田" });
  S.addSkill({ domain: "共通", item: "A" });
  S.removeSkill(S.skills()[0].id);
  S.addSkill({ domain: "共通", item: "B" });
  eq(S.undoDelete(), false);

  S.removeSkill(S.skills()[0].id);
  S.addSkill({ domain: "共通", item: "C" });
  S.setRating(m.id, S.skills()[0].id, "4");
  eq(S.undoDelete(), false);

  S.removeSkill(S.skills()[0].id);
  S.importData({ version: 1, skills: [{ id: "sk9", domain: "共通", item: "取込" }], ratings: {} }, "replace");
  eq(S.undoDelete(), false);
  eq(S.skills().map((s) => s.item), ["取込"]);

  S.removeSkill(S.skills()[0].id);
  eq(S.removeSkill("no-such-id"), false); // 空振りは退避を潰さない
  eq(S.undoDelete(), true);
  eq(S.skills().map((s) => s.item), ["取込"]);

  S.removeSkill(S.skills()[0].id);
  S.forgetUndo();
  eq(S.undoDelete(), false);
  eq(S.skills().length, 0);
});
