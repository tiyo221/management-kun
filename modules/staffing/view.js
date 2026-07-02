/* モジュール staffing（要員計画）— ビュー（描画・イベント）。計算は MK.logic.staffing に委譲。CONVENTIONS §1
   PJ×メンバーのアサイン表と、メンバー別の空き要員（期間軸）を俯瞰する読み取り専用ビュー（spec §3.7.5）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.staffing;
  const PERIODS = [{ key: 13, label: "四半期" }, { key: 26, label: "半年" }, { key: 52, label: "1年" }];

  let root = null;
  const state = { period: 13, offset: 0 };

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("要員計画"));
    const ms = L().members();
    if (!ms.length) { root.appendChild(ui.emptyState("メンバーがいません。「人」で追加してください。")); return; }
    const list = L().alloc();
    const tg = L().targets();
    const weeks = weekMondays(state.period, state.offset);
    const refDate = MK.util.todayISO(); // アサイン表・空き集計の基準日は本日固定（期間軸スイッチャは下段の週次ストリップ専用）
    const ov = L().overviewOn(list, ms, tg, refDate, L().DEFAULT_CAPACITY);

    const body = [toolbar(refDate)];
    if (!list.length) {
      body.push(ui.card([ui.emptyState("アロケーション（計画）がありません。「負荷」モジュールの「計画」タブで、各メンバーをプロジェクトへ割り当ててください。")], { flush: true }));
    }
    body.push(freeCard(ov, list, ms, weeks));
    if (tg.length) body.push(assignCard(ov, ms, tg));
    root.appendChild(ui.stack(body));
  }

  function toolbar(refDate) {
    const bar = ui.toolbar([]);
    bar.appendChild(inlinePills(PERIODS, state.period, (k) => { state.period = k; render(); }));
    bar.appendChild(ui.button("◀", { variant: "btn-ghost", onClick: () => { state.offset--; render(); } }));
    bar.appendChild(ui.button("今日", { variant: "btn-ghost", onClick: () => { state.offset = 0; render(); } }));
    bar.appendChild(ui.button("▶", { variant: "btn-ghost", onClick: () => { state.offset++; render(); } }));
    bar.appendChild(el("span", { class: "sub", text: "アサイン表は本日（" + refDate + "）時点／期間切替は下段の空き推移用" }));
    return bar;
  }
  // 数値 key の pill 群（ui.pillTabs は文字列 key 前提のため。workload と同様）
  function inlinePills(items, active, onChange) {
    const wrap = el("span", { style: "display:inline-flex;gap:4px;" });
    items.forEach((it) => { const b = el("button", { class: "pill-tab" + (it.key === active ? " active" : ""), text: it.label }); b.addEventListener("click", () => onChange(it.key)); wrap.appendChild(b); });
    return wrap;
  }

  // 表示期間分の週開始日（月曜）を生成（workload と同じ暦。共有 util を使用）
  function weekMondays(period, offset) {
    const start = MK.util.addDays(MK.util.mondayOf(MK.util.todayISO()), (offset || 0) * 7);
    const arr = []; for (let i = 0; i < period; i++) arr.push(MK.util.addDays(start, i * 7));
    return arr;
  }

  // ---- 空き要員（メンバー別・期間軸）----
  function freeCard(ov, list, ms, weeks) {
    const cap = ov.capacity;
    const rows = ov.memberSummary.map((s, i) => {
      const m = s.member;
      const cls = s.over ? "wl-over" : (s.free <= cap * 0.2 ? "wl-under" : "wl-ok");
      const label = s.over ? ("過剰 " + Math.round(-s.free) + "%") : ("空き " + Math.round(s.free) + "%");
      const head = el("div", { class: "wl-head" }, [
        el("span", { class: "wl-dot", style: "background:" + colorOf(m, i) + ";" }),
        el("span", { class: "wl-name", text: m.name }),
        el("span", { class: "wl-badge " + cls, text: label }),
        el("span", { class: "wl-peak", text: "割当 " + Math.round(s.assigned) + "% / キャパ " + cap + "%" }),
      ]);
      return el("div", { class: "wl-member" }, [head, freeStrip(L().freeSeries(list, m.id, weeks, cap), weeks, cap)]);
    });
    return ui.card([el("h3", { text: "空き要員（週ごと・" + weeks[0] + " 〜）" })].concat(rows));
  }
  function freeStrip(vals, weeks, cap) {
    const todayMon = MK.util.mondayOf(MK.util.todayISO());
    const s = el("div", { class: "wl-strip" });
    vals.forEach((v, i) => { const cell = el("div", { class: "wl-week" + (weeks[i] === todayMon ? " today" : ""), title: weeks[i] + "：空き " + Math.round(v) + "%" }); cell.style.background = freeColor(v, cap); s.appendChild(cell); });
    return s;
  }
  // 空きが多い＝濃い緑、少ない＝薄い、負（過剰）＝赤。トークン参照でダーク追従。
  function freeColor(v, cap) {
    if (v < 0) return "var(--color-error)";
    if (v <= 0) return "var(--color-surface)";
    const ratio = Math.min(1, v / (cap || 100));
    return "rgba(26,174,57," + (0.15 + ratio * 0.7).toFixed(2) + ")";
  }

  // ---- アサイン表（PJ×メンバー）----
  function assignCard(ov, ms, tg) {
    const table = el("table", { class: "mk-matrix" });
    const thead = el("thead");
    const hr = el("tr");
    hr.appendChild(el("th", { class: "rowhead", text: "プロジェクト＼メンバー" }));
    ms.forEach((m) => hr.appendChild(el("th", { text: m.name })));
    hr.appendChild(el("th", { text: "PJ計" }));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el("tbody");
    ov.rows.forEach((r) => {
      const tr = el("tr");
      tr.appendChild(el("td", { class: "rowhead", text: r.target.name, title: r.target.name }));
      r.cells.forEach((c) => tr.appendChild(el("td", { class: "mk-heat", text: c.percent ? c.percent + "%" : "" })));
      tr.appendChild(el("td", { class: "mk-heat", text: r.total ? r.total + "%" : "" }));
      tbody.appendChild(tr);
    });
    // メンバー別の割当合計行
    const foot = el("tr", { class: "domain-row" });
    foot.appendChild(el("td", { class: "rowhead", text: "割当合計" }));
    ov.memberSummary.forEach((s) => foot.appendChild(el("td", { class: "mk-heat" + (s.over ? " gap-short" : ""), text: Math.round(s.assigned) + "%" })));
    foot.appendChild(el("td", { text: "" }));
    tbody.appendChild(foot);
    table.appendChild(tbody);

    const wrap = el("div", { class: "mk-matrix-wrap" }, [table]);
    return ui.card([el("h3", { text: "アサイン表（基準日 " + ov.date + "）" }), wrap]);
  }

  // メンバー表示色（People マスタの color 優先、無ければパレット循環。workload と揃える）
  const PALETTE = ["#5645d4", "#0075de", "#dd5b00", "#1aae39", "#ff64c8", "#2a9d99"];
  function colorOf(m, i) { return (m && m.color) || PALETTE[i % PALETTE.length]; }

  MK.registerModule("staffing", {
    title: "要員計画", icon: "🧑‍🤝‍🧑",
    scope: "global",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
  });
})();
