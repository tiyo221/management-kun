/* モジュール resource（リソース＝要員計画）— ビュー（描画・イベント）。計算は MK.logic.resource に委譲。CONVENTIONS §1
   アロケーション（共有マスタ MK.allocations）を編集し、PJ×メンバーのアサイン表・メンバー別の空き要員（期間軸）・
   月次の供給とキャパ（要員確保のリードタイム向け早期警告）を俯瞰する（spec §3.7.5 / Issue #52）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.resource;
  const PERIODS = [{ key: 13, label: "四半期" }, { key: 26, label: "半年" }, { key: 52, label: "1年" }];

  let root = null;
  let ctx = null; // マスタ編集は ctx.allocations 経由（spec §3.5）
  const state = { period: 13, offset: 0 };

  // マスタ編集入口（契約に沿って ctx.allocations / ctx.demands を使う。未取得時は global へフォールバック）
  function allocMaster() { return (ctx && ctx.allocations) || MK.allocations; }
  function demandMaster() { return (ctx && ctx.demands) || MK.demands; }

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("リソース"));
    const ms = L().members();
    if (!ms.length) { root.appendChild(ui.emptyState("メンバーがいません。「人」で追加してください。")); return; }
    const list = L().alloc();
    const tg = L().targets();
    const weeks = weekMondays(state.period, state.offset);
    const months = L().monthsInHorizon(state.period, state.offset);
    const refDate = MK.util.todayISO(); // アサイン表・空き集計の基準日は本日固定（期間軸スイッチャは下段の推移専用）
    const ov = L().overviewOn(list, ms, tg, refDate, L().DEFAULT_CAPACITY);

    const demands = L().demandsAll();
    const body = [toolbar(refDate, tg)];
    body.push(planCard(list, tg));
    if (tg.length) body.push(demandCard(demands, tg));
    if (tg.length) body.push(gapCard(L().gapByMonth(list, demands, months)));
    body.push(supplyCard(L().supplyByMonth(list, ms, months, L().DEFAULT_CAPACITY)));
    body.push(freeCard(ov, list, ms, weeks));
    if (tg.length) body.push(assignCard(ov, ms, tg));
    root.appendChild(ui.stack(body));
  }

  function toolbar(refDate, tg) {
    const bar = ui.toolbar([]);
    if (tg.length) bar.appendChild(ui.button("＋ アロケーション", { variant: "btn-primary", onClick: () => editAllocation(null) }));
    if (tg.length) bar.appendChild(ui.button("＋ 需要", { variant: "btn-secondary", onClick: () => editDemand(null) }));
    bar.appendChild(inlinePills(PERIODS, state.period, (k) => { state.period = k; render(); }));
    bar.appendChild(ui.button("◀", { variant: "btn-ghost", onClick: () => { state.offset--; render(); } }));
    bar.appendChild(ui.button("今月", { variant: "btn-ghost", onClick: () => { state.offset = 0; render(); } }));
    bar.appendChild(ui.button("▶", { variant: "btn-ghost", onClick: () => { state.offset++; render(); } }));
    bar.appendChild(el("span", { class: "sub", text: "アサイン表は本日（" + refDate + "）時点／期間切替は下段の月次・週次推移用" }));
    return bar;
  }

  // ---- 計画（共有アロケーション。§3.7.5）----
  // 器（Project 等）は次元 config を回して集める。コードで "project" を決め打ちしない（§3.7.6）。
  function targetOptions() {
    const opts = [];
    ((MK.scope && MK.scope.dims()) || []).forEach((dim) => {
      const master = MK.scope.master(dim);
      if (master && typeof master.all === "function") master.all().forEach((e) => opts.push({ value: e.id, label: e.name || "(無題)", dim: dim.dim }));
    });
    return opts;
  }
  function targetLabel(opts, targetId) { const o = opts.find((x) => x.value === targetId); return o ? o.label : "(不明な対象)"; }
  function memberName(mid) { const m = L().members().find((x) => x.id === mid); return m ? m.name : "(不明)"; }

  function planCard(list, tg) {
    if (!tg.length) return ui.card([ui.emptyState("計画の対象となるプロジェクトがありません。「プロジェクト」マスタで追加してください。")], { flush: true });
    const intro = el("p", { class: "sub", text: "各メンバーをプロジェクトへ期間×割当%で計画します。WBS の担当とは独立した計画レコードです。" });
    if (!list.length) return ui.card([intro, ui.emptyState("アロケーションがありません。「＋ アロケーション」から追加してください。")]);
    const opts = targetOptions();
    const ul = el("ul", { class: "mk-list" });
    list.forEach((a) => ul.appendChild(allocRow(a, opts)));
    return ui.card([intro, ul]);
  }

  function allocRow(a, opts) {
    const period = (a.startDate || "?") + " 〜 " + (a.endDate || "?");
    const info = el("div", { class: "grow", style: "cursor:pointer;" }, [
      el("div", { text: memberName(a.memberId) + " → " + targetLabel(opts, a.targetId) }),
      el("div", { class: "sub", text: "割当 " + a.percent + "% / " + period }),
    ]);
    info.addEventListener("click", () => editAllocation(a));
    return el("li", { class: "mk-row" }, [info, ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("このアロケーションを削除しますか？").then((ok) => { if (ok) { allocMaster().remove(a.id); render(); } }) })]);
  }

  function editAllocation(a) {
    const ms = L().members();
    const opts = targetOptions();
    const f = {
      member: ui.select(ms.map((m) => ({ value: m.id, label: m.name })), a ? a.memberId : (ms[0] && ms[0].id)),
      target: ui.select(opts.map((o) => ({ value: o.value, label: o.label })), a ? a.targetId : (opts[0] && opts[0].value)),
      percent: ui.input({ type: "number", value: a ? a.percent : 50 }),
      start: ui.input({ type: "date", value: a ? a.startDate : "" }),
      end: ui.input({ type: "date", value: a ? a.endDate : "" }),
      note: ui.textarea(a ? a.note : ""),
    };
    MK.ui.modal({ title: a ? "アロケーションを編集" : "アロケーションを追加", body: ui.stack([
      ui.field("メンバー", f.member), ui.field("プロジェクト", f.target), ui.field("割当（%）", f.percent),
      ui.field("開始日", f.start), ui.field("終了日", f.end), ui.field("メモ", f.note),
    ]), actions: [
      a ? { label: "削除", variant: "btn-danger", onClick: (c) => MK.ui.confirm("削除しますか？").then((ok) => { if (ok) { allocMaster().remove(a.id); c(); render(); } }) } : null,
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => {
          if (!f.target.value) { MK.ui.toast("プロジェクトを選択してください", "error"); return; }
          if (f.start.value && f.end.value && f.end.value < f.start.value) { MK.ui.toast("終了日は開始日以降にしてください", "error"); return; }
          const dimOf = (opts.find((o) => o.value === f.target.value) || {}).dim || "project";
          const patch = { memberId: f.member.value, targetId: f.target.value, dim: dimOf, percent: Math.max(0, Number(f.percent.value) || 0), startDate: f.start.value || "", endDate: f.end.value || "", note: f.note.value };
          if (a) allocMaster().update(a.id, patch); else allocMaster().create(patch);
          c(); render();
        } },
    ].filter(Boolean) });
  }
  // 数値 key の pill 群（ui.pillTabs は文字列 key 前提のため）
  function inlinePills(items, active, onChange) {
    const wrap = el("span", { style: "display:inline-flex;gap:4px;" });
    items.forEach((it) => { const b = el("button", { class: "pill-tab" + (it.key === active ? " active" : ""), text: it.label }); b.addEventListener("click", () => onChange(it.key)); wrap.appendChild(b); });
    return wrap;
  }

  // 表示期間分の週開始日（月曜）を生成（共有 util を使用）
  function weekMondays(period, offset) {
    const start = MK.util.addDays(MK.util.mondayOf(MK.util.todayISO()), (offset || 0) * 7);
    const arr = []; for (let i = 0; i < period; i++) arr.push(MK.util.addDays(start, i * 7));
    return arr;
  }

  // ---- 需要（共有マスタ MK.demands。Issue #68 / #52 Phase 2）----
  // 「この器がこの期間に何%（＝何人分）必要か」を編集する。アロケーション（供給）と対の需要事実。
  function demandCard(demands, tg) {
    const intro = el("p", { class: "sub", text: "各プロジェクトが期間×必要%で「何人分必要か」を見積もります。供給（アロケーション）と対の需要で、下の月次ギャップの分子になります。" });
    if (!demands.length) return ui.card([el("h3", { text: "需要（プロジェクト別）" }), intro, ui.emptyState("需要がありません。「＋ 需要」から追加してください。")]);
    const opts = targetOptions();
    const ul = el("ul", { class: "mk-list" });
    demands.forEach((d) => ul.appendChild(demandRow(d, opts)));
    return ui.card([el("h3", { text: "需要（プロジェクト別）" }), intro, ul]);
  }
  function demandRow(d, opts) {
    const period = (d.startDate || "?") + " 〜 " + (d.endDate || "?");
    const info = el("div", { class: "grow", style: "cursor:pointer;" }, [
      el("div", { text: targetLabel(opts, d.targetId) }),
      el("div", { class: "sub", text: "必要 " + d.requiredPercent + "% / " + period }),
    ]);
    info.addEventListener("click", () => editDemand(d));
    return el("li", { class: "mk-row" }, [info, ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("この需要を削除しますか？").then((ok) => { if (ok) { demandMaster().remove(d.id); render(); } }) })]);
  }
  function editDemand(d) {
    const opts = targetOptions();
    const f = {
      target: ui.select(opts.map((o) => ({ value: o.value, label: o.label })), d ? d.targetId : (opts[0] && opts[0].value)),
      required: ui.input({ type: "number", value: d ? d.requiredPercent : 100 }),
      start: ui.input({ type: "date", value: d ? d.startDate : "" }),
      end: ui.input({ type: "date", value: d ? d.endDate : "" }),
      note: ui.textarea(d ? d.note : ""),
    };
    MK.ui.modal({ title: d ? "需要を編集" : "需要を追加", body: ui.stack([
      ui.field("プロジェクト", f.target), ui.field("必要（%・100超可）", f.required),
      ui.field("開始日", f.start), ui.field("終了日", f.end), ui.field("メモ", f.note),
    ]), actions: [
      d ? { label: "削除", variant: "btn-danger", onClick: (c) => MK.ui.confirm("削除しますか？").then((ok) => { if (ok) { demandMaster().remove(d.id); c(); render(); } }) } : null,
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => {
          if (!f.target.value) { MK.ui.toast("プロジェクトを選択してください", "error"); return; }
          if (f.start.value && f.end.value && f.end.value < f.start.value) { MK.ui.toast("終了日は開始日以降にしてください", "error"); return; }
          const dimOf = (opts.find((o) => o.value === f.target.value) || {}).dim || "project";
          const patch = { targetId: f.target.value, dim: dimOf, requiredPercent: Math.max(0, Number(f.required.value) || 0), startDate: f.start.value || "", endDate: f.end.value || "", note: f.note.value };
          if (d) demandMaster().update(d.id, patch); else demandMaster().create(patch);
          c(); render();
        } },
    ].filter(Boolean) });
  }

  // ---- 需要 × 供給の月次ギャップ（いつまでに確保が必要か。Issue #68）----
  // gap = 需要 − 約束済み供給。gap>0 の月＝供給不足で、その月までに確保が必要（確保デッドライン）。
  function gapCard(rows) {
    const anyDemand = rows.some((r) => r.demand > 0);
    if (!anyDemand) return ui.card([el("h3", { text: "需要 × 供給（月次ギャップ）" }), ui.emptyState("需要が未登録です。「＋ 需要」を追加すると、いつまでに何%分の確保が必要かが月次で出ます。")], { flush: true });
    const firstShort = rows.find((r) => r.short);
    const lead = firstShort
      ? el("p", { class: "sub", text: "最初に供給不足になるのは " + monthLabel(firstShort.month) + "（不足 " + Math.round(firstShort.gap) + "%）。それまでに確保・応援を手当てしてください。" })
      : el("p", { class: "sub", text: "現時点の供給は全月で需要を満たしています。" });
    const list = el("div", { class: "mk-month-list" });
    rows.forEach((r) => {
      const cls = r.short ? "wl-over" : "wl-ok";
      const label = r.short ? ("不足 " + Math.round(r.gap) + "%") : ("充足 +" + Math.round(-r.gap) + "%");
      const head = el("div", { class: "wl-head" }, [
        el("span", { class: "wl-name", text: monthLabel(r.month) }),
        el("span", { class: "wl-badge " + cls, text: label }),
        el("span", { class: "wl-peak" + (r.short ? " hot" : ""), text: "需要 " + Math.round(r.demand) + "% / 供給 " + Math.round(r.supply) + "%" }),
      ]);
      list.appendChild(el("div", { class: "mk-month-row" }, [head]));
    });
    return ui.card([el("h3", { text: "需要 × 供給（月次ギャップ・" + monthLabel(rows[0] && rows[0].month) + " 〜）" }), lead, list]);
  }

  // ---- 月次の供給とキャパ（要員確保のリードタイム向け早期警告。Issue #52）----
  // 供給がキャパを超える月＝オーバーコミット、空きが尽きる月を先まで見せる。週次の凸凹は見せない。
  function supplyCard(rows) {
    const thisMonth = MK.util.todayISO().slice(0, 7);
    const list = el("div", { class: "mk-month-list" });
    rows.forEach((r) => {
      const over = r.free < 0;
      const tight = !over && r.cap > 0 && r.free <= r.cap * 0.1; // 空きが1割以下＝逼迫
      const ratio = r.cap > 0 ? r.assigned / r.cap : 0;
      const cls = over ? "wl-over" : (tight ? "wl-under" : "wl-ok");
      const label = over ? ("超過 " + Math.round(-r.free) + "%") : ("空き " + Math.round(r.free) + "%");
      const bar = el("div", { class: "mk-month-bar" }, [
        el("div", { class: "mk-month-fill" + (over ? " over" : (tight ? " tight" : "")), style: "width:" + Math.min(100, Math.round(ratio * 100)) + "%;" }),
      ]);
      const head = el("div", { class: "wl-head" }, [
        el("span", { class: "wl-name" + (r.month.slice(0, 7) === thisMonth ? " today" : ""), text: monthLabel(r.month) }),
        el("span", { class: "wl-badge " + cls, text: label }),
        el("span", { class: "wl-peak" + (r.overCount ? " hot" : ""), text: "割当 " + Math.round(r.assigned) + "% / キャパ " + r.cap + "%" + (r.overCount ? "（過剰 " + r.overCount + "人）" : "") }),
      ]);
      list.appendChild(el("div", { class: "mk-month-row" }, [head, bar]));
    });
    const intro = el("p", { class: "sub", text: "供給（割当）がキャパを超える月＝オーバーコミット。空きが尽きる前に増員・応援を手当てする早期警告です。" });
    return ui.card([el("h3", { text: "月ごとの供給とキャパ（" + monthLabel(rows[0] && rows[0].month) + " 〜）" }), intro, list]);
  }
  function monthLabel(monthFirst) { if (!monthFirst) return ""; const y = monthFirst.slice(0, 4), m = Number(monthFirst.slice(5, 7)); return y + "年" + m + "月"; }

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

  // メンバー表示色（People マスタの color 優先、無ければパレット循環）
  const PALETTE = ["#5645d4", "#0075de", "#dd5b00", "#1aae39", "#ff64c8", "#2a9d99"];
  function colorOf(m, i) { return (m && m.color) || PALETTE[i % PALETTE.length]; }

  // サンプルのアロケーション（計画）を共有マスタへ投入する。people/projects 投入後に呼ばれる
  // 前提で名寄せ（resolveOrCreate）が既存に一致する（shared/sample.js）。旧 staffing から移設（Issue #52）。
  function loadSample() {
    const today = MK.util.todayISO();
    const sato = MK.people.resolveOrCreate("佐藤 花子"), suzuki = MK.people.resolveOrCreate("鈴木 一郎"), tanaka = MK.people.resolveOrCreate("田中 美咲");
    const alpha = MK.projects.resolveOrCreate("新製品ローンチ"), beta = MK.projects.resolveOrCreate("サイトリニューアル");
    const end = MK.util.addDays(today, 84);
    MK.allocations.replaceAll([
      { id: MK.util.uid("a"), memberId: suzuki, targetId: alpha, dim: "project", startDate: today, endDate: end, percent: 60, note: "" },
      { id: MK.util.uid("a"), memberId: suzuki, targetId: beta, dim: "project", startDate: today, endDate: end, percent: 30, note: "" },
      { id: MK.util.uid("a"), memberId: sato, targetId: alpha, dim: "project", startDate: today, endDate: end, percent: 50, note: "" },
      { id: MK.util.uid("a"), memberId: tanaka, targetId: beta, dim: "project", startDate: today, endDate: end, percent: 80, note: "" },
    ]);
    // 需要（供給と対）。alpha は供給110%に対し200%必要＝不足を可視化する（Issue #68）。
    if (MK.demands) MK.demands.replaceAll([
      { id: MK.util.uid("d"), targetId: alpha, dim: "project", startDate: today, endDate: end, requiredPercent: 200, note: "2名体制が必要" },
      { id: MK.util.uid("d"), targetId: beta, dim: "project", startDate: today, endDate: end, requiredPercent: 100, note: "" },
    ]);
  }

  MK.registerModule("resource", {
    title: "リソース", icon: "🧑‍🤝‍🧑",
    scope: "global",
    mount(container, context) { ctx = context; root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; ctx = null; },
    summary() { return L().summary(); },
    loadSample,
  });
})();
