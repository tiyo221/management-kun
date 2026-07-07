/* モジュール resource（リソース＝要員計画）— ビュー（描画・イベント）。計算は MK.logic.resource に委譲。CONVENTIONS §1
   マネージャの3つの問い「① あと何人足りない？ ② 外注が要る？ ③ メンバーの負担は大丈夫？」に1:1のカードで答える
   （Issue #71）。主単位は人（FTE、1人＝100%）・時間軸は月次×長ホライズン。データの入力（アロケーション＝供給・
   需要）は共有マスタ（MK.allocations / MK.demands）を ctx 経由で編集する（spec §3.7.5 / Issue #52）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.resource;
  const PERIODS = [{ key: 13, label: "四半期" }, { key: 26, label: "半年" }, { key: 52, label: "1年" }];

  let root = null;
  let ctx = null; // マスタ編集は ctx.allocations / ctx.demands 経由（spec §3.5）
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
    const tg = L().targets();
    if (!tg.length) { root.appendChild(ui.card([ui.emptyState("対象となるプロジェクトがありません。「プロジェクト」マスタで追加してください。")], { flush: true })); return; }

    const list = L().alloc();
    const demands = L().demandsAll();
    const months = L().monthsInHorizon(state.period, state.offset);
    const matrix = L().shortageMatrix(list, demands, tg, months);
    const anyDemand = matrix.rows.some((r) => r.cells.some((c) => c.demand > 0));

    root.appendChild(ui.stack([
      toolbar(),
      shortageCard(matrix, anyDemand, months),
      outsourceCard(L().outsourcingByMonth(list, demands, tg, ms, months), anyDemand),
      loadCard(L().memberLoadByMonth(list, ms, months), list, months),
      inputCard(list, demands),
    ]));
  }

  function toolbar() {
    const bar = ui.toolbar([]);
    bar.appendChild(ui.button("＋ アサイン", { variant: "btn-primary", onClick: () => editAllocation(null) }));
    bar.appendChild(ui.button("＋ 必要人数", { variant: "btn-secondary", onClick: () => editDemand(null) }));
    bar.appendChild(inlinePills(PERIODS, state.period, (k) => { state.period = k; render(); }));
    bar.appendChild(ui.button("◀", { variant: "btn-ghost", onClick: () => { state.offset--; render(); } }));
    bar.appendChild(ui.button("今月", { variant: "btn-ghost", onClick: () => { state.offset = 0; render(); } }));
    bar.appendChild(ui.button("▶", { variant: "btn-ghost", onClick: () => { state.offset++; render(); } }));
    bar.appendChild(el("span", { class: "sub", text: "1人＝100%（FTE）。各月15日時点で集計" }));
    return bar;
  }

  // ---- ① あと何人足りない？（PJ別・月別の不足人数）----
  function shortageCard(matrix, anyDemand, months) {
    const title = el("h3", { text: "① あと何人足りない？" });
    if (!anyDemand) return ui.card([title, ui.emptyState("必要人数が未登録です。「＋ 必要人数」で各プロジェクトに何人必要かを登録すると、月ごとの不足人数が出ます。")]);
    const firstShort = matrix.totals.find((t) => t.short);
    const lead = firstShort
      ? el("p", { class: "sub", text: "最初に足りなくなるのは " + monthLabel(firstShort.month) + "（チーム全体であと " + L().fteLabel(firstShort.shortage) + " 不足）。" })
      : el("p", { class: "sub", text: "全月で必要人数を確保できています。" });

    const table = el("table", { class: "mk-matrix" });
    const hr = el("tr");
    hr.appendChild(el("th", { class: "rowhead", text: "プロジェクト＼月" }));
    months.forEach((mo) => hr.appendChild(el("th", { text: monthLabel(mo) })));
    table.appendChild(el("thead", {}, [hr]));

    const tbody = el("tbody");
    matrix.rows.forEach((r) => {
      const tr = el("tr");
      tr.appendChild(el("td", { class: "rowhead", text: r.target.name, title: r.target.name }));
      r.cells.forEach((c) => {
        const detail = "必要 " + L().fteLabel(c.demand) + " / 確保 " + L().fteLabel(c.supply);
        const text = c.short ? (L().fteLabel(c.gap) + "不足") : (c.demand > 0 ? "OK" : "—"); // — ＝ 需要なし（不足合計行と揃える）
        tr.appendChild(el("td", { class: "mk-heat" + (c.short ? " gap-short" : ""), text, title: detail }));
      });
      tbody.appendChild(tr);
    });
    // 月ごとの不足合計（不足している PJ の分だけを合算。他 PJ の余剰では相殺しない）
    const foot = el("tr", { class: "domain-row" });
    foot.appendChild(el("td", { class: "rowhead", text: "不足合計" }));
    matrix.totals.forEach((t) => foot.appendChild(el("td", { class: "mk-heat" + (t.short ? " gap-short" : ""), text: t.short ? L().fteLabel(t.shortage) : "—" })));
    tbody.appendChild(foot);
    table.appendChild(tbody);

    return ui.card([title, lead, el("div", { class: "mk-matrix-wrap" }, [table])]);
  }

  // ---- ② 外注が要る？（不足をチームの空き要員で吸収できるか）----
  function outsourceCard(rows, anyDemand) {
    const title = el("h3", { text: "② 外注が要る？" });
    if (!anyDemand) return ui.card([title, ui.emptyState("必要人数が未登録のため判定できません。「＋ 必要人数」を追加してください。")]);
    const firstOut = rows.find((r) => r.needsOutsource);
    const anyShort = rows.some((r) => r.shortage > 0);
    const lead = firstOut
      ? el("p", { class: "sub", text: "内部の空きで吸収できない不足が " + monthLabel(firstOut.month) + " に出ます（外注候補 " + L().fteLabel(firstOut.outsource) + "）。それまでに外注・応援を手当てしてください。" })
      : el("p", { class: "sub", text: anyShort ? "不足はありますが、チームの空き要員で吸収できる見込みです（外注不要）。" : "不足がないため外注は不要です。" });
    const list = el("div", { class: "mk-month-list" });
    rows.forEach((r) => {
      const cls = r.needsOutsource ? "wl-over" : (r.shortage > 0 ? "wl-under" : "wl-ok");
      const label = r.needsOutsource ? ("外注 " + L().fteLabel(r.outsource)) : (r.shortage > 0 ? "内部で吸収可" : "不足なし");
      const head = el("div", { class: "wl-head" }, [
        el("span", { class: "wl-name", text: monthLabel(r.month) }),
        el("span", { class: "wl-badge " + cls, text: label }),
        el("span", { class: "wl-peak" + (r.needsOutsource ? " hot" : ""), text: "不足 " + L().fteLabel(r.shortage) + " / チームの空き " + L().fteLabel(r.internalFree) }),
      ]);
      list.appendChild(el("div", { class: "mk-month-row" }, [head]));
    });
    return ui.card([title, lead, list]);
  }

  // ---- ③ メンバーの負担は大丈夫？（割当が1人分を超えるメンバーを強調）----
  function loadCard(loads, list, months) {
    const title = el("h3", { text: "③ メンバーの負担は大丈夫？" });
    if (!list.length) return ui.card([title, ui.emptyState("アサインがありません。「＋ アサイン」で誰をどのプロジェクトに割り当てるかを登録してください。")]);
    const overs = loads.filter((x) => x.anyOver);
    const lead = overs.length
      ? el("p", { class: "sub", text: "1人分（100%）を超える月があるメンバー: " + overs.map((x) => x.member.name).join("、") + "。割当の見直しか増員を検討してください。" })
      : el("p", { class: "sub", text: "全員の割当が1人分（100%）以内です。" });

    const table = el("table", { class: "mk-matrix" });
    const hr = el("tr");
    hr.appendChild(el("th", { class: "rowhead", text: "メンバー＼月" }));
    months.forEach((mo) => hr.appendChild(el("th", { text: monthLabel(mo) })));
    table.appendChild(el("thead", {}, [hr]));
    const tbody = el("tbody");
    loads.forEach((x) => {
      const tr = el("tr");
      tr.appendChild(el("td", { class: "rowhead", text: x.member.name, title: x.member.name }));
      x.cells.forEach((c) => {
        const text = c.assigned ? L().fteLabel(c.assigned) : "";
        tr.appendChild(el("td", { class: "mk-heat" + (c.over ? " gap-short" : ""), text, title: "割当 " + Math.round(c.assigned) + "%" + (c.over ? "（" + L().fteLabel(c.overBy) + " 超過）" : "") }));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return ui.card([title, lead, el("div", { class: "mk-matrix-wrap" }, [table])]);
  }

  // ---- 計画の入力（アロケーション＝供給・需要。共有マスタの編集）----
  function inputCard(list, demands) {
    const opts = targetOptions();
    const kids = [el("h3", { text: "計画の入力" }),
      el("p", { class: "sub", text: "上の3つの判断のもとになるデータです。アサイン＝誰をどこへ何%割り当てるか（供給）、必要人数＝各プロジェクトに何人分必要か。" })];
    kids.push(el("h3", { text: "アサイン（供給）" }));
    if (!list.length) kids.push(ui.emptyState("アサインがありません。「＋ アサイン」から追加してください。"));
    else { const ul = el("ul", { class: "mk-list" }); list.forEach((a) => ul.appendChild(allocRow(a, opts))); kids.push(ul); }
    kids.push(el("h3", { text: "必要人数" }));
    if (!demands.length) kids.push(ui.emptyState("必要人数がありません。「＋ 必要人数」から追加してください。"));
    else { const ul = el("ul", { class: "mk-list" }); demands.forEach((d) => ul.appendChild(demandRow(d, opts))); kids.push(ul); }
    return ui.card(kids);
  }

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

  function allocRow(a, opts) {
    const period = (a.startDate || "?") + " 〜 " + (a.endDate || "?");
    const info = el("div", { class: "grow", style: "cursor:pointer;" }, [
      el("div", { text: memberName(a.memberId) + " → " + targetLabel(opts, a.targetId) }),
      el("div", { class: "sub", text: L().fteLabel(a.percent) + "（" + a.percent + "%） / " + period }),
    ]);
    info.addEventListener("click", () => editAllocation(a));
    return el("li", { class: "mk-row" }, [info, ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("このアサインを削除しますか？").then((ok) => { if (ok) { allocMaster().remove(a.id); render(); } }) })]);
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
    MK.ui.modal({ title: a ? "アサインを編集" : "アサインを追加", body: ui.stack([
      ui.field("メンバー", f.member), ui.field("プロジェクト", f.target), ui.field("割当（%・100=1人分）", f.percent),
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

  function demandRow(d, opts) {
    const period = (d.startDate || "?") + " 〜 " + (d.endDate || "?");
    const info = el("div", { class: "grow", style: "cursor:pointer;" }, [
      el("div", { text: targetLabel(opts, d.targetId) }),
      el("div", { class: "sub", text: "必要 " + L().fteLabel(d.requiredPercent) + "（" + d.requiredPercent + "%） / " + period }),
    ]);
    info.addEventListener("click", () => editDemand(d));
    return el("li", { class: "mk-row" }, [info, ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("この必要人数を削除しますか？").then((ok) => { if (ok) { demandMaster().remove(d.id); render(); } }) })]);
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
    MK.ui.modal({ title: d ? "必要人数を編集" : "必要人数を追加", body: ui.stack([
      ui.field("プロジェクト", f.target), ui.field("必要（%・100=1人分。100超可）", f.required),
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

  function monthLabel(monthFirst) { if (!monthFirst) return ""; const y = monthFirst.slice(0, 4), m = Number(monthFirst.slice(5, 7)); return y + "年" + m + "月"; }

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
    // 需要（供給と対）。alpha は確保1.1人に対し2.0人必要＝不足0.9人を可視化する（Issue #68 / #71）。
    if (MK.demands) MK.demands.replaceAll([
      { id: MK.util.uid("d"), targetId: alpha, dim: "project", startDate: today, endDate: end, requiredPercent: 200, note: "2名体制が必要" },
      { id: MK.util.uid("d"), targetId: beta, dim: "project", startDate: today, endDate: end, requiredPercent: 100, note: "" },
    ]);
  }

  MK.registerModule("resource", {
    title: "リソース", icon: "🧑‍🤝‍🧑",
    description: "人が足りているかを判断する",
    scope: "global",
    mount(container, context) { ctx = context; root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; ctx = null; },
    summary() { return L().summary(); },
    summaryFor(entityType, id) { return L().summaryFor(entityType, id); },
    loadSample,
  });
})();
