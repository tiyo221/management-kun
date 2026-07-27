/* metrics ロジック（指標ツリー・実績・達成度・CRUD・入出力）spec/modules/metrics.md / Issue #168 */
"use strict";

test("metrics: 追加は name 必須・種別/方向は既定へ正規化", (MK) => {
  // 観点: name 空は null で保存されず、揃えば kind 既定=kpi・direction 既定=up で追加される。未知値も正規化される
  // 入力: name 空 → 追加不可 / name あり（kind/direction 未指定）→ 追加 / 未知 kind="bogus"・direction="sideways" で追加
  // 期待: 空は null で metrics=0、既定は kind=kpi・direction=up、未知は kpi/up に寄る
  const M = MK.logic.metrics;
  eq(M.addMetric({ name: "  " }), null);
  eq(M.metrics().length, 0);
  const a = M.addMetric({ name: "登録数" });
  eq(a.kind, "kpi");
  eq(a.direction, "up");
  const b = M.addMetric({ name: "X", kind: "bogus", direction: "sideways" });
  eq(b.kind, "kpi");
  eq(b.direction, "up");
});

test("metrics: achievement は direction を考慮して達成可否と比率を返す", (MK) => {
  // 観点: up は value>=target で達成・ratio=value/target、down は value<=target で達成・ratio=target/value。目標or実績が無ければ null
  // 入力: up 指標（目標100・実績80）／down 指標（目標3・実績2）／目標なし指標／実績なし指標
  // 期待: up→met=false・ratio=0.8、down→met=true・ratio=1.5、目標なし・実績なしは null
  const M = MK.logic.metrics;
  const up = M.addMetric({ name: "up", direction: "up", targetValue: 100 });
  M.setRecord(up.id, "2026-07", 80);
  const aUp = M.achievement(M.metrics().find((x) => x.id === up.id));
  eq(aUp.met, false);
  almost(aUp.ratio, 0.8);

  const down = M.addMetric({ name: "down", direction: "down", targetValue: 3 });
  M.setRecord(down.id, "2026-07", 2);
  const aDown = M.achievement(M.metrics().find((x) => x.id === down.id));
  eq(aDown.met, true);
  almost(aDown.ratio, 1.5);

  const noTarget = M.addMetric({ name: "notarget" });
  M.setRecord(noTarget.id, "2026-07", 10);
  eq(M.achievement(M.metrics().find((x) => x.id === noTarget.id)), null);

  const noRec = M.addMetric({ name: "norec", targetValue: 10 });
  eq(M.achievement(M.metrics().find((x) => x.id === noRec.id)), null);
});

test("metrics: latestRecord は period 昇順の最後（最新期間）を返す", (MK) => {
  // 観点: 実績は投入順でなく period の辞書順（＝同一粒度の時系列）で最新を選ぶ
  // 入力: 2026-05→2026-07→2026-06 の順で投入
  // 期待: latest は 2026-07（最大 period）
  const M = MK.logic.metrics;
  const m = M.addMetric({ name: "m" });
  M.setRecord(m.id, "2026-05", 1);
  M.setRecord(m.id, "2026-07", 3);
  M.setRecord(m.id, "2026-06", 2);
  eq(M.latestRecord(M.metrics()[0]).period, "2026-07");
});

test("metrics: setRecord は同一 period を上書き（upsert）し、非数は拒否", (MK) => {
  // 観点: 同じ period の再投入は行を増やさず値を更新する。value 非数・period 空は保存しない
  // 入力: 2026-07=10 → 2026-07=20（上書き）／value="abc"（非数）／period=""（空）
  // 期待: records は1件で value=20、非数・空は null で件数不変
  const M = MK.logic.metrics;
  const m = M.addMetric({ name: "m" });
  M.setRecord(m.id, "2026-07", 10);
  M.setRecord(m.id, "2026-07", 20);
  eq(M.metrics()[0].records.length, 1);
  eq(M.metrics()[0].records[0].value, 20);
  eq(M.setRecord(m.id, "2026-08", "abc"), null);
  eq(M.setRecord(m.id, "", 5), null);
  eq(M.metrics()[0].records.length, 1);
});

test("metrics: tree は KGI→NSM→KPI を深さ優先で depth 付きに並べる", (MK) => {
  // 観点: parentId の自由木を親→子の DFS 順で平坦化し、各行に階層の深さ depth を付ける
  // 入力: KGI（トップ）← NSM ← KPI1/KPI2 の木
  // 期待: 並びは [KGI(0), NSM(1), KPI1(2), KPI2(2)]
  const M = MK.logic.metrics;
  const kgi = M.addMetric({ name: "KGI", kind: "kgi" });
  const nsm = M.addMetric({ name: "NSM", kind: "nsm" });
  M.setParent(nsm.id, kgi.id);
  const k1 = M.addMetric({ name: "KPI1", kind: "kpi" });
  const k2 = M.addMetric({ name: "KPI2", kind: "kpi" });
  M.setParent(k1.id, nsm.id);
  M.setParent(k2.id, nsm.id);
  const rows = M.tree(M.metrics()).map((r) => [r.node.name, r.depth]);
  eq(rows, [["KGI", 0], ["NSM", 1], ["KPI1", 2], ["KPI2", 2]]);
});

test("metrics: setParent は自分自身・子孫を親にできない（循環拒否）", (MK) => {
  // 観点: 循環を作る親付け替えを拒否する。自分自身、および自分の子孫を親には指定できない
  // 入力: 親A←子B の木で、setParent(A,A)／setParent(A,B)（子を親に）／存在しない親／正常な付け替え
  // 期待: 自己・子孫・不明親は false（親不変）、正常な付け替えは true
  const M = MK.logic.metrics;
  const a = M.addMetric({ name: "A" });
  const b = M.addMetric({ name: "B" });
  M.setParent(b.id, a.id);
  eq(M.setParent(a.id, a.id), false);      // 自分自身
  eq(M.setParent(a.id, b.id), false);      // 子孫を親に（循環）
  eq(M.setParent(a.id, "no_such_id"), false); // 存在しない親
  eq(M.metrics().find((x) => x.id === a.id).parentId, null); // 親は変わらない
  eq(M.setParent(a.id, null), true);       // トップへ（正常）
});

test("metrics: removeMetric は子を親へ引き上げる（葉を失わない）", (MK) => {
  // 観点: 中間ノードを削除しても子孫を巻き込まず、子は削除ノードの親へ付け替わる
  // 入力: KGI←NSM←KPI の木で NSM を削除
  // 期待: NSM は消え、KPI の parentId が KGI になる（総数は 3→2）
  const M = MK.logic.metrics;
  const kgi = M.addMetric({ name: "KGI" });
  const nsm = M.addMetric({ name: "NSM" });
  M.setParent(nsm.id, kgi.id);
  const kpi = M.addMetric({ name: "KPI" });
  M.setParent(kpi.id, nsm.id);
  M.removeMetric(nsm.id);
  eq(M.metrics().length, 2);
  eq(M.metrics().find((x) => x.id === kpi.id).parentId, kgi.id);
});

test("metrics: roots は parentId が欠落（孤児）のノードもトップ扱いにする", (MK) => {
  // 観点: 親削除などで parentId が存在しない id を指す孤児は、木の描画から漏れないようトップとして扱う
  // 入力: 実在しない親 id を持つノードを1件作る
  // 期待: roots に含まれ、tree の並びにも depth=0 で現れる
  const M = MK.logic.metrics;
  const orphan = M.addMetric({ name: "孤児", parentId: "ghost" }); // 追加時に無効な親は null 化される
  eq(orphan.parentId, null);
  // 直接データを壊して孤児を再現（親が後から消えた状況）
  M.updateMetric(orphan.id, {});
  const d = M.load(); d.metrics[0].parentId = "ghost"; M.save(d);
  eq(M.roots(M.metrics()).length, 1);
  eq(M.tree(M.metrics())[0].depth, 0);
});

test("metrics: summary は達成/計測中・未記録・未達を返す", (MK) => {
  // 観点: HOME 用サマリー。目標＋実績のある指標で met/measured、実績ゼロで未記録、未達は attention(warn)
  // 入力: 達成1（目標100/実績120）・未達1（目標100/実績80）・未記録1（目標のみ）
  // 期待: 空は empty=true。stats[0]=達成 1/2・stats[1]=未記録 1、attention に 未達 1件(warn)
  const M = MK.logic.metrics;
  const s0 = M.summary();
  eq(s0.empty, true);
  const win = M.addMetric({ name: "達成", targetValue: 100, direction: "up" });
  M.setRecord(win.id, "2026-07", 120);
  const lose = M.addMetric({ name: "未達", targetValue: 100, direction: "up" });
  M.setRecord(lose.id, "2026-07", 80);
  M.addMetric({ name: "未記録", targetValue: 50 });
  const s = M.summary();
  eq(s.empty, false);
  eq(s.stats[0].label, "達成");
  eq(s.stats[0].value, "1/2");
  eq(s.stats[1].label, "未記録");
  eq(s.stats[1].value, 1);
  eq(s.attention.length, 1);
  eq(s.attention[0].label, "未達 1件");
  eq(s.attention[0].severity, "warn");
});

test("metrics: 循環を含む取込データでも descendantsOf/tree は無限再帰しない", (MK) => {
  // 観点: importData は外部 JSON をそのまま格納するため循環（A→B→A）もありうる。木の走査は seen で防御し落ちない
  // 入力: parentId が相互参照する A↔B を replace で取り込む
  // 期待: descendantsOf(A) は有限で返り（B を含む）、tree は2ノードを列挙して例外にならない
  const M = MK.logic.metrics;
  M.importData({ metrics: [
    { id: "A", name: "A", kind: "kpi", unit: "", direction: "up", parentId: "B", targetValue: null, records: [], note: "" },
    { id: "B", name: "B", kind: "kpi", unit: "", direction: "up", parentId: "A", targetValue: null, records: [], note: "" },
  ] }, "replace");
  const desc = M.descendantsOf(M.metrics(), "A");
  assert(desc.indexOf("B") >= 0, "B は A の子孫");
  eq(M.tree(M.metrics()).length, 2); // 両ノードを取りこぼさず列挙（循環でも有限）
});

test("metrics: importData の replace と merge", (MK) => {
  // 観点: replace は全置換、merge は id 一致で上書きしつつ既存を残す
  // 入力: 既存A を作り、merge で {A の id→上書きA, 新規B}／その後 replace で {置換のみ1件}
  // 期待: merge 後は2件（A が「上書きA」に）、replace 後は1件だけ残る
  const M = MK.logic.metrics;
  const a = M.addMetric({ name: "既存A" });
  M.importData({ metrics: [
    { id: a.id, name: "上書きA", kind: "kpi", unit: "", direction: "up", parentId: null, targetValue: null, records: [], note: "" },
    { id: "m_x", name: "新規B", kind: "kpi", unit: "", direction: "up", parentId: null, targetValue: null, records: [], note: "" },
  ] }, "merge");
  eq(M.metrics().length, 2);
  eq(M.metrics().find((x) => x.id === a.id).name, "上書きA");
  M.importData({ metrics: [{ id: "m_y", name: "置換のみ", kind: "kpi", unit: "", direction: "up", parentId: null, targetValue: null, records: [], note: "" }] }, "replace");
  eq(M.metrics().length, 1);
  eq(M.metrics()[0].name, "置換のみ");
});
