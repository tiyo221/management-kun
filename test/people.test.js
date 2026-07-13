/* people マスタ（MK.people）— CSV 取込／出力（Issue #57）。 */
"use strict";

test("people: CSV 出力・取込（往復・氏名空スキップ・有効フラグ）", (MK) => {
  // 観点: buildCSVRows のヘッダ、applyCSV が全置換・氏名空はスキップ・有効フラグ解釈
  // 入力: 4行（山田=true／佐藤="false"／退職者="無効"／氏名空="true"）を applyCSV
  // 期待: 取込 3件（氏名空はスキップ）、"false"/"無効" は active=false、ヘッダは既定列順
  const P = MK.people;
  const rows = [
    ["氏名", "役割", "表示色", "備考", "有効"],
    ["山田太郎", "PM", "#ff0000", "リーダー", "true"],
    ["佐藤花子", "デザイナー", "", "", "false"],
    ["退職者", "", "", "", "無効"],
    ["", "役割のみ", "", "空行", "true"], // 氏名なしはスキップ
  ];
  const n = P.applyCSV(rows);
  eq(n, 3);
  eq(P.all().length, 3);
  const yamada = P.all().find((m) => m.name === "山田太郎");
  eq(yamada.role, "PM");
  eq(yamada.color, "#ff0000");
  eq(yamada.active, true);
  eq(P.all().find((m) => m.name === "佐藤花子").active, false); // "false" → false
  eq(P.all().find((m) => m.name === "退職者").active, false); // "無効" → false
  eq(P.buildCSVRows()[0], ["氏名", "役割", "表示色", "備考", "有効"]);
});

test("people: CSV 有効は空/未指定なら true", (MK) => {
  // 観点: 「有効」列が空・列自体が無い場合は active=true
  // 入力: 「有効」列を持たない ["氏名","役割"],["田中","SE"] を applyCSV
  // 期待: 1件取込・active=true（未指定は有効の既定）
  const P = MK.people;
  const n = P.applyCSV([["氏名", "役割"], ["田中", "SE"]]);
  eq(n, 1);
  eq(P.all()[0].active, true);
});

test("people: CSV round-trip（出力→取込で氏名等が保たれる）", (MK) => {
  // 観点: buildCSVRows → applyCSV で主要フィールドが往復する
  // 自明: 出力した行をそのまま取り込み、role/color/note/active が保たれるだけの素朴なラウンドトリップ
  const P = MK.people;
  P.create({ name: "往復太郎", role: "QA", color: "#00ff00", note: "メモ", active: false });
  const rows = P.buildCSVRows();
  P.applyCSV(rows);
  const m = P.all().find((x) => x.name === "往復太郎");
  eq(m.role, "QA");
  eq(m.color, "#00ff00");
  eq(m.note, "メモ");
  eq(m.active, false);
});
