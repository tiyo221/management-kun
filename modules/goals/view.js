/* モジュール goals — ビュー（描画・イベント）。計算は MK.logic.goals に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.goals;

  let root = null;
  let view = "roadmap";
  let selectedId = null;
  // 部分更新（CONVENTIONS §2.5-4）用。ステップ操作は「行」ではなく詳細ペイン（階段）を単位に差し替える
  // （完了トグルは現在ステップ「いまここ」や頂上「到達」など他段・ヘッダへ波及するため）。左の目標リストは
  // 作り直さず、選択中目標の進捗表示（sideSubById）だけ更新して選択・スクロールを保つ。
  let mainPaneNode = null;   // 詳細ペイン（.mk-goals-main）
  let sideSubById = {};      // goalId → 左リスト項目の進捗 sub 要素
  let sideTitleById = {};    // goalId → 左リスト項目のタイトル要素（インライン改名で揃える）
  let summitTextNode = null; // 詳細ペインの頂上（階段の最上段）のタイトル要素

  // 左リスト・詳細で共用する進捗表示文言。
  function progressText(g) {
    const pr = L().progress(g);
    return pr.pct + "%（" + pr.done + "/" + pr.total + "）" + (L().isAchieved(g) ? " ✅" : "");
  }

  // 詳細ペインだけ作り直す（ステップ操作後。全再描画しない）。対象目標が消えていれば全再描画へ委ねる。
  function refreshDetail() {
    if (!mainPaneNode) return;
    const g = L().getGoal(selectedId);
    if (!g) { render(); return; }
    mainPaneNode.innerHTML = "";
    renderGoalDetail(mainPaneNode, g);
  }

  // 左リストの該当目標の進捗表示だけ差し替える（リスト自体は作り直さない）。
  function refreshSideProgress(id) {
    const sub = sideSubById[id];
    const g = L().getGoal(id);
    if (sub && g) sub.textContent = progressText(g);
  }

  // ステップ操作後の後始末: 詳細ペインを差し替え、左リストの進捗を更新する（§2.5-4）。
  function afterStepChange(gid) { refreshDetail(); refreshSideProgress(gid); }

  // 大目標のタイトル（インライン編集。CONVENTIONS §2.5-2）。説明・期限との3項目まとめ編集は
  // 「編集」ボタンのモーダルに残す。
  function goalTitleEdit(g) {
    return ui.inlineEdit({
      value: g.title,
      placeholder: "(無題)",
      onCommit: (next) => {
        if (!next) { MK.ui.toast("タイトルを入力してください", "error"); return false; } // 空は拒否＝元値へ
        L().updateGoal(g.id, { title: next });
        g.title = next; // 詳細ペインが握るスナップショットを揃える（編集モーダルの初期値に効く）
        applyGoalTitle(g);
        return true;
      },
    });
  }

  // 改名を、同じタイトルを映している他の箇所（左リスト・階段の頂上）へ反映する。
  // 進捗も並びも変わらないので詳細ペインごと作り直さない（全再描画しない・§2.5-4）。
  function applyGoalTitle(g) {
    const side = sideTitleById[g.id];
    if (side) side.textContent = g.title || "(無題)";
    if (summitTextNode && selectedId === g.id) {
      summitTextNode.textContent = (g.title || "(無題)") + (L().isAchieved(g) ? " 到達！" : "");
    }
  }

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("目標"));
    root.appendChild(ui.pillTabs([{ key: "roadmap", label: "ロードマップ" }, { key: "dashboard", label: "ダッシュボード" }], view, (k) => { view = k; render(); }));
    // ツールバー（CSV）— 種別列でフラット化した goal/step を入出力する
    root.appendChild(ui.toolbar([
      ui.button("CSV出力", { onClick: () => { MK.io.downloadText("goals-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("目標CSVを書き出しました", "success"); } }),
      ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const n = L().applyCSV(rows); selectedId = null; render(); MK.ui.toast(n + " 件の目標を取り込みました", "success"); }) }),
    ]));
    if (view === "dashboard") renderDashboard(); else renderRoadmap();
  }

  // 削除は確認を挟まず即実行し、取り消しトーストを出す（CONVENTIONS §2.5-3）。復元は元の位置へ
  // 戻すため全再描画する（1回の明示操作なのでコスト許容）。
  // 目標を消したら詳細ペインの選択を外し、戻したらその目標を選び直す（消す前の画面へ戻す）。
  function removeGoalWithUndo(g) {
    const wasSelected = selectedId === g.id;
    if (wasSelected) selectedId = null;
    const removed = L().removeGoal(g.id);
    render(); // 空振り（既に消えている）でも画面をストアへ合わせ直す
    if (!removed) return; // 空振りでトーストを出すと、その取り消しが別の1件を復元しかねない
    // 削除後の render が選び直した目標（先頭）を覚えておく。復元時にまだそれが選ばれていれば
    // 消す前の選択へ戻し、利用者がトースト表示中に別の目標を選んでいたらその選択を尊重する。
    const autoPicked = selectedId;
    MK.ui.undoDeleteToast("「" + (g.title || "無題") + "」を削除しました", () => L().undoDelete(), () => {
      if (wasSelected && selectedId === autoPicked) selectedId = g.id;
      render();
    });
  }

  // ステップ削除（一覧の行・編集モーダルの両方から使う）。削除・復元とも詳細ペインの部分更新で足りる
  // （afterStepChange はストアから描き直すので、位置を戻す復元にもそのまま追随する・§2.5-4）。
  function removeStepWithUndo(g, s) {
    MK.ui.removeWithUndo(
      { remove: (id) => L().removeStep(g.id, id), undoRemove: () => L().undoDelete() },
      s.id,
      "ステップ「" + (s.title || "無題") + "」を削除しました",
      () => afterStepChange(g.id)
    );
  }

  function renderRoadmap() {
    const list = L().goals();
    if (selectedId == null && list.length) selectedId = list[0].id;

    const side = el("div", { class: "mk-goals-side" });
    side.appendChild(ui.button("＋ 大目標", { variant: "btn-primary", onClick: () => promptText("新しい大目標", "タイトル", (v) => { if (v) { selectedId = L().addGoal(v); render(); } }) }));
    if (!list.length) side.appendChild(el("div", { class: "sub mk-muted", text: "大目標がありません" }));
    // 部分更新（refreshSideProgress / applyGoalTitle）で参照する対応表を作り直す。
    // 頂上は詳細ペイン側（renderGoalDetail）で入れ直すので、ここでは掴んだままにしない。
    sideSubById = {}; sideTitleById = {}; summitTextNode = null;
    list.forEach((g) => {
      const sub = el("div", { class: "sub", text: progressText(g) });
      sideSubById[g.id] = sub;
      const titleEl = el("div", { text: g.title || "(無題)" });
      sideTitleById[g.id] = titleEl;
      const item = el("div", { class: "mk-goal-item" + (g.id === selectedId ? " active" : "") }, [titleEl, sub]);
      item.addEventListener("click", () => { selectedId = g.id; render(); });
      side.appendChild(item);
    });

    const mainPane = el("div", { class: "mk-goals-main" });
    mainPaneNode = mainPane; // 詳細ペインの部分更新（refreshDetail）対象
    const g = L().getGoal(selectedId);
    if (!g && !list.length) mainPane.appendChild(ui.emptyState({
      title: "まだ大目標がありません",
      hint: "達成したいことを大目標として登録し、ステップに分解して進捗を追いましょう。",
      action: { label: "＋ 最初の大目標を追加", onClick: () => promptText("新しい大目標", "タイトル", (v) => { if (v) { selectedId = L().addGoal(v); render(); } }) },
    }));
    else if (!g) mainPane.appendChild(ui.emptyState("大目標を選択または作成してください"));
    else renderGoalDetail(mainPane, g);

    root.appendChild(el("div", { class: "mk-goals-layout" }, [side, mainPane]));
  }

  function renderGoalDetail(host, g) {
    // 頂上は階段（ステップが1つ以上あるとき）にしか無い。前回描画のノードを掴んだままにしない。
    summitTextNode = null;
    const pr = L().progress(g);
    const head = ui.card([
      el("div", { class: "mk-row mk-goal-head" }, [
        el("div", { class: "grow" }, [
          // 見出しはインライン編集（CONVENTIONS §2.5-2）。説明・期限との3項目まとめ編集は
          // 「編集」ボタンのモーダルに残す。改名は左リストの見出しにも出るので、そこも揃える。
          el("h3", {}, [goalTitleEdit(g)]),
          el("div", { class: "sub", text: (g.deadline ? "期限 " + g.deadline + " / " : "") + "作成 " + g.createdAt + (g.achievedAt ? " / 達成 " + g.achievedAt : "") }),
        ]),
        ui.button("編集", { variant: "btn-ghost", onClick: () => editGoal(g) }),
        ui.button("削除", { variant: "btn-ghost", onClick: () => removeGoalWithUndo(g) }),
      ]),
      g.description ? el("p", { class: "sub", text: g.description }) : null,
      L().isAchieved(g) ? el("div", { class: "mk-goal-done-banner", text: "🎉 ゴール到達！全ステップ完了" }) : null,
      el("div", { class: "progress mk-barline" }, [el("i", { style: "width:" + pr.pct + "%;" })]),
      el("div", { class: "sub", text: "進捗 " + pr.pct + "%（" + pr.done + "/" + pr.total + "）" }),
    ]);

    const stepInput = ui.input({ placeholder: "ステップを入力して追加", onEnter: (v) => { if (v.trim()) { L().addStep(g.id, v); afterStepChange(g.id); } } });
    const stepCard = ui.card([ui.toolbar([stepInput, ui.button("追加", { variant: "btn-primary", onClick: () => { if (stepInput.value.trim()) { L().addStep(g.id, stepInput.value); afterStepChange(g.id); } } })])]);
    if (!g.steps.length) stepCard.appendChild(ui.emptyState("ステップがありません"));
    else stepCard.appendChild(staircase(g));

    host.appendChild(ui.stack([head, stepCard]));
  }

  // 目標（頂上）を上・スタートを下とした階段状レイアウト。
  // 完了ステップが下から積み上がり頂上へ近づくフロー感を出す（case b / Issue #13）。
  function staircase(g) {
    const n = g.steps.length;
    const curId = L().currentStepId(g);
    const reached = L().isAchieved(g);
    const wrap = el("div", { class: "mk-staircase" });
    // 頂上（目標）— 全ステップの上・最も奥（インデント最大）に置く
    summitTextNode = el("span", { text: (g.title || "(無題)") + (reached ? " 到達！" : "") });
    wrap.appendChild(el("div", { class: "mk-summit mk-stair-indent" + (reached ? " reached" : ""), style: indent(n) }, [
      el("span", { class: "mk-summit-flag", text: reached ? "🏁" : "🎯" }),
      summitTextNode,
    ]));
    // 目標寄り（末尾ステップ=上）→ スタート（先頭=下）へ描画
    for (let i = n - 1; i >= 0; i--) wrap.appendChild(stairRow(g, g.steps[i], i, curId));
    return wrap;
  }

  // 段のインデント（先頭=0、上へ行くほど深くして階段状に見せる。過大な段数は頭打ち）。
  // 何段目かだけを CSS 変数で渡し、1段あたりの幅は .mk-stair-indent が持つ（design.css）。
  function indent(i) { const cap = 10; return "--mk-depth:" + Math.min(i, cap) + ";"; }

  function stairRow(g, s, idx, curId) {
    const done = s.status === "done";
    const current = s.id === curId;
    const dot = el("div", { class: "mk-step-dot", title: done ? "完了を取り消す" : "完了にする", text: done ? "✓" : String(idx + 1) });
    // 完了トグルは「いまここ」や頂上「到達」・ヘッダの進捗へ波及するため、行でなく詳細ペイン単位で
    // 差し替え、左リストの進捗だけ更新する（全再描画せず選択・スクロールを保つ・§2.5-4）。
    dot.addEventListener("click", () => { L().toggleStep(g.id, s.id, !done); afterStepChange(g.id); });

    // タイトルはインライン編集（CONVENTIONS §2.5-2）。説明・振り返りメモとの3項目まとめ編集は
    // 「編集」ボタンのモーダルに残す。改名は進捗も並びも変えないので行内で完結する（§2.5-4）。
    const titleEdit = ui.inlineEdit({
      value: s.title,
      placeholder: "(無題)",
      onCommit: (next) => {
        if (!next) { MK.ui.toast("タイトルを入力してください", "error"); return false; } // 空は拒否＝元値へ
        L().updateStep(g.id, s.id, { title: next });
        s.title = next; // 編集モーダルの初期値がずれないようスナップショットを揃える
        return true;
      },
    });
    const titleEl = el("div", { class: done ? "mk-done" : "" }, [titleEdit, current ? el("span", { class: "mk-here", text: "いまここ" }) : null]);
    const meta = s.review ? [el("div", { class: "sub", text: "📝 " + s.review })] : [];
    const grow = el("div", { class: "grow" }, [titleEl].concat(meta));

    // 表示は上=目標寄りのため、視覚の上/下に合わせて moveStep 方向を反転（↑=末尾方向=+1、↓=先頭方向=-1）
    return el("div", { class: "mk-stair mk-stair-indent" + (done ? " done" : "") + (current ? " current" : ""), style: indent(idx) }, [
      dot, grow,
      ui.button("↑", { variant: "btn-ghost", onClick: () => { L().moveStep(g.id, s.id, 1); afterStepChange(g.id); } }),
      ui.button("↓", { variant: "btn-ghost", onClick: () => { L().moveStep(g.id, s.id, -1); afterStepChange(g.id); } }),
      // タイトルのクリックはインライン編集が取るため、モーダルへの導線は明示のボタンにする。
      ui.button("編集", { variant: "btn-ghost", title: "説明・振り返りメモを編集", onClick: () => editStep(g, s) }),
      ui.button("削除", { variant: "btn-ghost", onClick: () => removeStepWithUndo(g, s) }),
    ]);
  }

  function renderDashboard() {
    // ダッシュボードでは詳細ペイン・左リストが無い。部分更新の参照が前回ロードマップ描画時の
    // 切り離しノードを指したまま残らないようリセットする（afterStepChange はここでは発火しないが明確化）。
    mainPaneNode = null; sideSubById = {}; sideTitleById = {}; summitTextNode = null;
    const d = L().dashboardData();
    const stats = ui.statsRow([
      { num: d.achieveRate + "%", label: "大目標の達成率" },
      { num: d.achieved + "/" + d.total, label: "達成済み大目標" },
      { num: d.totalDone, label: "累計完了ステップ" },
    ]);
    const chartCard = ui.card([el("h3", { text: "大目標ごとの完了ステップ数" })]);
    if (!d.chart.length) chartCard.appendChild(ui.emptyState("データがありません"));
    else { const w = el("div"); w.innerHTML = barChartSVG(d.chart); chartCard.appendChild(w); }
    root.appendChild(ui.stack([stats, chartCard]));
  }

  function barChartSVG(data) {
    const esc = MK.util.escapeHtml;
    const W = Math.max(320, data.length * 80), H = 220, base = H - 36;
    const max = Math.max(1, Math.max.apply(null, data.map((d) => d.value)));
    const bw = 44, gap = (W - data.length * bw) / (data.length + 1);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="完了ステップ数の棒グラフ">';
    s += '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="var(--color-hairline)"></line>';
    data.forEach((d, i) => {
      const x = gap + i * (bw + gap), h = (d.value / max) * (base - 24), y = base - h;
      s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="4" fill="var(--color-primary)"></rect>';
      s += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="12" fill="var(--color-ink)">' + d.value + '</text>';
      const lbl = d.label.length > 6 ? d.label.slice(0, 6) + "…" : d.label;
      s += '<text x="' + (x + bw / 2) + '" y="' + (base + 18) + '" text-anchor="middle" font-size="11" fill="var(--color-steel)">' + esc(lbl) + '</text>';
    });
    return s + "</svg>";
  }

  function editGoal(g) {
    const f = { title: ui.input({ value: g.title }), desc: ui.textarea(g.description), deadline: ui.input({ type: "date", value: g.deadline || "" }) };
    MK.ui.modal({ title: "大目標を編集", body: ui.stack([ui.field("タイトル", f.title), ui.field("説明", f.desc), ui.field("期限", f.deadline)]), actions: [
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => { if (!f.title.value.trim()) { MK.ui.toast("タイトルを入力してください", "error"); return; } L().updateGoal(g.id, { title: f.title.value.trim(), description: f.desc.value, deadline: f.deadline.value || null }); c(); render(); } },
    ] });
  }
  function editStep(g, s) {
    const f = { title: ui.input({ value: s.title }), desc: ui.textarea(s.description), review: ui.textarea(s.review) };
    MK.ui.modal({ title: "ステップを編集", body: ui.stack([ui.field("タイトル", f.title), ui.field("説明", f.desc), ui.field("振り返りメモ", f.review)]), actions: [
      // 先にモーダルを閉じてから削除＋取り消しトースト（モーダルの裏にトーストが隠れないように）。
      { label: "削除", variant: "btn-danger", onClick: (c) => { c(); removeStepWithUndo(g, s); } },
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => { if (!f.title.value.trim()) { MK.ui.toast("タイトルを入力してください", "error"); return; } L().updateStep(g.id, s.id, { title: f.title.value.trim(), description: f.desc.value, review: f.review.value }); c(); render(); } },
    ] });
  }
  function promptText(title, label, cb) {
    const input = ui.input({});
    MK.ui.modal({ title, body: ui.field(label, input), actions: [
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "OK", variant: "btn-primary", onClick: (c) => { cb(input.value.trim()); c(); } },
    ] });
    setTimeout(() => input.focus(), 0);
  }

  MK.registerModule("goals", {
    title: "目標", icon: "🎯",
    description: "目標を立てて達成度を追う",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; mainPaneNode = null; sideSubById = {}; sideTitleById = {}; summitTextNode = null; },
    summary() { return L().summary(); },
    searchItems() { return L().searchItems(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
