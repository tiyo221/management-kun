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

  function renderRoadmap() {
    const list = L().goals();
    if (selectedId == null && list.length) selectedId = list[0].id;

    const side = el("div", { class: "mk-goals-side" });
    side.appendChild(ui.button("＋ 大目標", { variant: "btn-primary", onClick: () => promptText("新しい大目標", "タイトル", (v) => { if (v) { selectedId = L().addGoal(v); render(); } }) }));
    if (!list.length) side.appendChild(el("div", { class: "sub mk-muted", text: "大目標がありません" }));
    list.forEach((g) => {
      const pr = L().progress(g);
      const item = el("div", { class: "mk-goal-item" + (g.id === selectedId ? " active" : "") }, [
        el("div", { text: g.title || "(無題)" }),
        el("div", { class: "sub", text: pr.pct + "%（" + pr.done + "/" + pr.total + "）" + (L().isAchieved(g) ? " ✅" : "") }),
      ]);
      item.addEventListener("click", () => { selectedId = g.id; render(); });
      side.appendChild(item);
    });

    const mainPane = el("div", { class: "mk-goals-main" });
    const g = L().getGoal(selectedId);
    if (!g) mainPane.appendChild(ui.emptyState("大目標を選択または作成してください"));
    else renderGoalDetail(mainPane, g);

    root.appendChild(el("div", { class: "mk-goals-layout" }, [side, mainPane]));
  }

  function renderGoalDetail(host, g) {
    const pr = L().progress(g);
    const head = ui.card([
      el("div", { class: "mk-row", style: "border:none;padding:0 0 8px;" }, [
        el("div", { class: "grow" }, [
          el("h3", { text: g.title || "(無題)" }),
          el("div", { class: "sub", text: (g.deadline ? "期限 " + g.deadline + " / " : "") + "作成 " + g.createdAt + (g.achievedAt ? " / 達成 " + g.achievedAt : "") }),
        ]),
        ui.button("編集", { variant: "btn-ghost", onClick: () => editGoal(g) }),
        ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("「" + (g.title || "無題") + "」を削除しますか？").then((ok) => { if (ok) { if (selectedId === g.id) selectedId = null; L().removeGoal(g.id); render(); } }) }),
      ]),
      g.description ? el("p", { class: "sub", text: g.description }) : null,
      L().isAchieved(g) ? el("div", { class: "mk-goal-done-banner", text: "🎉 ゴール到達！全ステップ完了" }) : null,
      el("div", { class: "progress", style: "margin:8px 0;" }, [el("i", { style: "width:" + pr.pct + "%;" })]),
      el("div", { class: "sub", text: "進捗 " + pr.pct + "%（" + pr.done + "/" + pr.total + "）" }),
    ]);

    const stepInput = ui.input({ placeholder: "ステップを入力して追加", onEnter: (v) => { if (v.trim()) { L().addStep(g.id, v); render(); } } });
    const stepCard = ui.card([ui.toolbar([stepInput, ui.button("追加", { variant: "btn-primary", onClick: () => { if (stepInput.value.trim()) { L().addStep(g.id, stepInput.value); render(); } } })])]);
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
    wrap.appendChild(el("div", { class: "mk-summit" + (reached ? " reached" : ""), style: indent(n) }, [
      el("span", { class: "mk-summit-flag", text: reached ? "🏁" : "🎯" }),
      el("span", { text: (g.title || "(無題)") + (reached ? " 到達！" : "") }),
    ]));
    // 目標寄り（末尾ステップ=上）→ スタート（先頭=下）へ描画
    for (let i = n - 1; i >= 0; i--) wrap.appendChild(stairRow(g, g.steps[i], i, curId));
    return wrap;
  }

  // 段のインデント（先頭=0、上へ行くほど深くして階段状に見せる。過大な段数は頭打ち）。
  function indent(i) { const unit = 26, cap = 10; return "margin-left:" + Math.min(i, cap) * unit + "px;"; }

  function stairRow(g, s, idx, curId) {
    const done = s.status === "done";
    const current = s.id === curId;
    const dot = el("div", { class: "mk-step-dot", title: done ? "完了を取り消す" : "完了にする", text: done ? "✓" : String(idx + 1) });
    dot.addEventListener("click", () => { L().toggleStep(g.id, s.id, !done); render(); });

    const titleEl = el("div", { class: done ? "mk-done" : "" }, [s.title || "(無題)", current ? el("span", { class: "mk-here", text: "いまここ" }) : null]);
    const meta = s.review ? [el("div", { class: "sub", text: "📝 " + s.review })] : [];
    const grow = el("div", { class: "grow", style: "cursor:pointer;" }, [titleEl].concat(meta));
    grow.addEventListener("click", () => editStep(g, s));

    // 表示は上=目標寄りのため、視覚の上/下に合わせて moveStep 方向を反転（↑=末尾方向=+1、↓=先頭方向=-1）
    return el("div", { class: "mk-stair" + (done ? " done" : "") + (current ? " current" : ""), style: indent(idx) }, [
      dot, grow,
      ui.button("↑", { variant: "btn-ghost", onClick: () => { L().moveStep(g.id, s.id, 1); render(); } }),
      ui.button("↓", { variant: "btn-ghost", onClick: () => { L().moveStep(g.id, s.id, -1); render(); } }),
      ui.button("削除", { variant: "btn-ghost", onClick: () => { L().removeStep(g.id, s.id); render(); } }),
    ]);
  }

  function renderDashboard() {
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
      { label: "削除", variant: "btn-danger", onClick: (c) => MK.ui.confirm("このステップを削除しますか？").then((ok) => { if (ok) { L().removeStep(g.id, s.id); c(); render(); } }) },
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
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
