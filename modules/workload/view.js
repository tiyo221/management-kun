/* モジュール workload — ビュー（描画・イベント）。計算は MK.logic.workload に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.workload;

  let root = null;
  const state = { view: "team", member: null, period: 13, offset: 0, showPlan: false };

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("負荷"));
    const bar = toolbar();
    if (!L().members().length) { root.appendChild(ui.stack([bar, ui.emptyState("メンバーがいません。「人の管理」で追加してください。")])); return; }
    const body = state.view === "team" ? renderTeam() : renderIndividual();
    root.appendChild(ui.stack([bar].concat(body)));
  }

  function toolbar() {
    const bar = ui.toolbar([]);
    // 計画（アロケーション）は要員計画モジュールへ移設した（Issue #45）。負荷はタスクの俯瞰に専念する。
    bar.appendChild(inlinePills([{ key: "team", label: "チーム" }, { key: "individual", label: "個人" }], state.view, (k) => { state.view = k; render(); }));
    bar.appendChild(inlinePills(L().PERIODS.map((p) => ({ key: p.key, label: p.label })), state.period, (k) => { state.period = k; render(); }));
    bar.appendChild(ui.button("◀", { variant: "btn-ghost", onClick: () => { state.offset--; render(); } }));
    bar.appendChild(ui.button("今日", { variant: "btn-ghost", onClick: () => { state.offset = 0; render(); } }));
    bar.appendChild(ui.button("▶", { variant: "btn-ghost", onClick: () => { state.offset++; render(); } }));
    bar.appendChild(ui.button("＋ タスク", { variant: "btn-primary", onClick: () => editTask(null) }));
    bar.appendChild(ui.button("CSV出力", { onClick: () => { MK.io.downloadText("workload-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildCSVRows()), "text/csv"); MK.ui.toast("負荷 CSV を書き出しました", "success"); } }));
    bar.appendChild(ui.button("CSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const r = L().applyCSV(rows); render(); MK.ui.toast("取込 " + r.ok + " 件" + (r.skip ? " / スキップ " + r.skip + " 件" : ""), r.skip ? "info" : "success"); }) }));
    bar.appendChild(ui.button("計画を保存", { onClick: () => { L().saveBaseline(); MK.ui.toast("計画を保存しました", "success"); render(); } }));
    if (L().hasBaseline()) {
      bar.appendChild(ui.button("計画を重ねる", { variant: state.showPlan ? "btn-primary" : "btn-secondary", onClick: () => { state.showPlan = !state.showPlan; render(); } }));
      bar.appendChild(ui.button("計画クリア", { variant: "btn-ghost", onClick: () => { L().clearBaseline(); state.showPlan = false; render(); } }));
    }
    return bar;
  }
  // 単一グループの pill 群（active を強調）。ui.pillTabs は文字列 key 前提なので数値 period 用にこちらを使用
  function inlinePills(items, active, onChange) {
    const wrap = el("span", { style: "display:inline-flex;gap:4px;" });
    items.forEach((it) => { const b = el("button", { class: "pill-tab" + (it.key === active ? " active" : ""), text: it.label }); b.addEventListener("click", () => onChange(it.key)); wrap.appendChild(b); });
    return wrap;
  }

  function renderTeam() {
    const weeks = L().weekMondays(state.period, state.offset);
    const ms = L().members();
    const series = ms.map((m, i) => ({ name: m.name, color: L().colorOf(m, i), values: L().series(m.id, weeks) }));
    if (state.showPlan) ms.forEach((m, i) => { const p = L().planSeries(m.id, weeks); if (p) series.push({ name: m.name + "（計画）", color: L().colorOf(m, i), values: p, dashed: true }); });
    const chartCard = ui.card([el("h3", { text: "週ごとの平均負担の推移" }), svgWrap(lineChartSVG(series, weeks))]);
    const listCard = ui.card(ms.map((m, i) => memberRow(m, i, weeks)));
    return [chartCard, listCard];
  }

  function memberRow(m, i, weeks) {
    return el("div", { class: "wl-member" }, [headEl(m, i, weeks), strip(L().stats(m.id, weeks).vals, weeks, L().warnOf(m.id).high)]);
  }
  function headEl(m, i, weeks) {
    const st = L().stats(m.id, weeks);
    const cls = st.state === "over" ? "wl-over" : (st.state === "under" ? "wl-under" : "wl-ok");
    const label = (st.state === "over" ? "過負荷 " : (st.state === "under" ? "余力 " : "適正 ")) + Math.round(st.avg) + "%";
    return el("div", { class: "wl-head" }, [
      el("span", { class: "wl-dot", style: "background:" + L().colorOf(m, i) + ";" }),
      el("span", { class: "wl-name", text: m.name }),
      el("span", { class: "wl-badge " + cls, text: label }),
      el("span", { class: "wl-peak" + (st.peak > st.high ? " hot" : ""), text: "ピーク " + Math.round(st.peak) + "%" }),
    ]);
  }
  function strip(vals, weeks, high) {
    const todayMon = MK.util.mondayOf(MK.util.todayISO());
    const s = el("div", { class: "wl-strip" });
    vals.forEach((v, i) => { const cell = el("div", { class: "wl-week" + (weeks[i] === todayMon ? " today" : ""), title: weeks[i] + "：" + Math.round(v) + "%" }); cell.style.background = loadColor(v, high); s.appendChild(cell); });
    return s;
  }
  function loadColor(v, high) {
    if (v <= 0) return "var(--color-surface)";
    if (v > high) return "var(--color-error)";
    return "rgba(86,69,212," + Math.min(0.9, 0.15 + (v / high) * 0.7).toFixed(2) + ")";
  }

  function renderIndividual() {
    const ms = L().members();
    if (!state.member || !ms.find((m) => m.id === state.member)) state.member = ms[0].id;
    const m = ms.find((x) => x.id === state.member), i = ms.indexOf(m);
    const weeks = L().weekMondays(state.period, state.offset);

    const sel = ui.select(ms.map((x) => ({ value: x.id, label: x.name })), state.member, (v) => { state.member = v; render(); });
    sel.style.maxWidth = "240px";

    const series = [{ name: m.name, color: L().colorOf(m, i), values: L().series(m.id, weeks) }];
    if (state.showPlan) { const p = L().planSeries(m.id, weeks); if (p) series.push({ name: "計画", color: L().colorOf(m, i), values: p, dashed: true }); }
    const chartCard = ui.card([headEl(m, i, weeks), svgWrap(lineChartSVG(series, weeks))]);

    const mine = L().tasksOf(m.id);
    let listCard;
    if (!mine.length) listCard = ui.card([ui.emptyState("タスクがありません。「＋ タスク」から追加してください。")], { flush: true });
    else { const ul = el("ul", { class: "mk-list" }); mine.forEach((t) => ul.appendChild(taskRow(t))); listCard = ui.card([ul], { flush: true }); }

    return [sel, chartCard, listCard];
  }

  function taskRow(t) {
    const period = (t.startDate || "?") + " 〜 " + (L().effEnd(t) || "?");
    const stLabel = (L().STATUS.find((s) => s.key === t.status) || {}).label || "";
    const info = el("div", { class: "grow", style: "cursor:pointer;" }, [el("div", { text: t.title || "(無題)" }), el("div", { class: "sub", text: "負担 " + t.load + "% / " + period + " / " + stLabel })]);
    info.addEventListener("click", () => editTask(t));
    return el("li", { class: "mk-row" }, [info, ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("このタスクを削除しますか？").then((ok) => { if (ok) { L().removeTask(t.id); render(); } }) })]);
  }

  function editTask(t) {
    const ms = L().members();
    const f = {
      title: ui.input({ value: t ? t.title : "" }),
      member: ui.select(ms.map((m) => ({ value: m.id, label: m.name })), t ? t.memberId : (state.view === "individual" && state.member ? state.member : (ms[0] && ms[0].id))),
      load: ui.input({ type: "number", value: t ? t.load : 30 }),
      start: ui.input({ type: "date", value: t ? t.startDate : "" }),
      end: ui.input({ type: "date", value: t ? t.endDate : "" }),
      status: ui.select(L().STATUS.map((s) => ({ value: s.key, label: s.label })), t ? t.status : "todo"),
      completed: ui.input({ type: "date", value: t ? t.completedDate : "" }),
      note: ui.textarea(t ? t.note : ""),
    };
    const compField = ui.field("完了日（完了時）", f.completed);
    const syncComp = () => { compField.style.display = f.status.value === "done" ? "" : "none"; };
    f.status.addEventListener("change", syncComp); syncComp();

    MK.ui.modal({ title: t ? "タスクを編集" : "タスクを追加", body: ui.stack([
      ui.field("タイトル", f.title), ui.field("担当メンバー", f.member), ui.field("負担（%・100超可）", f.load),
      ui.field("開始日", f.start), ui.field("終了日", f.end), ui.field("ステータス", f.status), compField, ui.field("メモ", f.note),
    ]), actions: [
      t ? { label: "削除", variant: "btn-danger", onClick: (c) => MK.ui.confirm("削除しますか？").then((ok) => { if (ok) { L().removeTask(t.id); c(); render(); } }) } : null,
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => {
          if (!f.title.value.trim()) { MK.ui.toast("タイトルを入力してください", "error"); return; }
          if (f.start.value && f.end.value && f.end.value < f.start.value) { MK.ui.toast("終了日は開始日以降にしてください", "error"); return; }
          const patch = { title: f.title.value.trim(), memberId: f.member.value, load: Math.max(0, Number(f.load.value) || 0), startDate: f.start.value || "", endDate: f.end.value || "", status: f.status.value, completedDate: f.status.value === "done" ? (f.completed.value || null) : null, note: f.note.value };
          if (t) L().updateTask(t.id, patch); else L().addTask(patch);
          c(); render();
        } },
    ].filter(Boolean) });
  }

  function svgWrap(svg) { const w = el("div"); w.innerHTML = svg; return w; }
  function lineChartSVG(series, weeks) {
    const padL = 32, padB = 18, padT = 8;
    const stepX = Math.max(10, Math.min(28, 720 / Math.max(1, weeks.length)));
    const W = padL + weeks.length * stepX + 8, plotH = 160, H = padT + plotH + padB;
    let maxV = 120; series.forEach((s) => s.values.forEach((v) => { if (v > maxV) maxV = v; }));
    const x = (i) => padL + i * stepX;
    const y = (v) => padT + plotH - (v / maxV) * plotH;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px;" role="img" aria-label="負荷推移">';
    s += '<line x1="' + padL + '" y1="' + y(100) + '" x2="' + (W - 8) + '" y2="' + y(100) + '" stroke="var(--color-hairline-strong)" stroke-dasharray="2 3"></line>';
    s += '<text x="2" y="' + (y(100) + 4) + '" font-size="9" fill="var(--color-steel)">100</text>';
    s += '<text x="2" y="' + y(0) + '" font-size="9" fill="var(--color-steel)">0</text>';
    const ti = weeks.indexOf(MK.util.mondayOf(MK.util.todayISO()));
    if (ti >= 0) s += '<line x1="' + x(ti) + '" y1="' + padT + '" x2="' + x(ti) + '" y2="' + (padT + plotH) + '" stroke="var(--color-error)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"></line>';
    series.forEach((ser) => { const pts = ser.values.map((v, i) => x(i) + "," + y(v)).join(" "); s += '<polyline points="' + pts + '" fill="none" stroke="' + ser.color + '" stroke-width="2"' + (ser.dashed ? ' stroke-dasharray="4 3" opacity="0.6"' : '') + '></polyline>'; });
    return s + "</svg>";
  }

  MK.registerModule("workload", {
    title: "負荷", icon: "📈",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
