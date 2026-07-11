/* モジュール skills — ビュー（描画・イベント）。計算/取込は MK.logic.skills に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.skills;

  let root = null;
  let ctx = null;
  let view = "matrix";
  let radarSel = null; // レーダー比較で選択中のメンバーID（Set。セッション内で保持）
  const RADAR_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

  // メンバー0件の空状態。人はマスタ管理（人の管理）で登録するため、そこへの導線を併置する。
  function membersEmpty(hint) {
    return ui.emptyState({
      title: "メンバーがいません",
      hint: hint,
      action: ctx && ctx.route ? { label: "人の管理を開く", onClick: () => ctx.route("master-people") } : null,
    });
  }

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("スキル"));
    root.appendChild(ui.pillTabs([{ key: "skills", label: "スキル管理" }, { key: "matrix", label: "紐づけ（評価入力）" }, { key: "dashboard", label: "ダッシュボード" }, { key: "radar", label: "レーダー" }], view, (k) => { view = k; render(); }));
    if (view === "skills") renderSkillsTab();
    else if (view === "matrix") renderMatrix();
    else if (view === "radar") renderRadar();
    else renderDashboard();
  }

  function renderSkillsTab() {
    const bar = ui.toolbar([
      ui.button("＋ スキルを追加", { variant: "btn-primary", onClick: () => editSkill(null) }),
      ui.button("スキルCSV出力", { onClick: () => { MK.io.downloadText("skills-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildSkillsCSVRows()), "text/csv"); MK.ui.toast("スキルCSVを書き出しました", "success"); } }),
      ui.button("スキルCSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const n = L().applySkillsCSV(rows); render(); MK.ui.toast(n + " 件のスキルを取り込みました（評価はクリア）", "success"); }) }),
    ]);
    const list = L().skills();
    let content;
    if (!list.length) content = ui.emptyState({
      title: "まだスキルがありません",
      hint: "評価したいスキル項目を登録すると、メンバーごとのレベルを紐づけ・可視化できます。",
      action: { label: "＋ 最初のスキルを追加", onClick: () => editSkill(null) },
    });
    else {
      content = ui.card([], { flush: true });
      L().domainsOrder(list).forEach((dom) => {
        content.appendChild(el("div", { class: "skill-domain-head", text: dom || "(大分類なし)" }));
        list.filter((s) => s.domain === dom).forEach((s) => content.appendChild(skillRow(s)));
      });
    }
    root.appendChild(ui.stack([bar, content]));
  }

  function skillRow(s) {
    const visChk = ui.checkbox(s.visible !== false);
    visChk.addEventListener("change", () => L().updateSkill(s.id, { visible: visChk.checked }));
    const coreChk = ui.checkbox(!!s.core);
    coreChk.addEventListener("change", () => { L().updateSkill(s.id, { core: coreChk.checked }); render(); });
    const meta = [];
    if (s.core) meta.push("コア");
    if (s.core && s.targetLevel != null) meta.push("目標Lv" + s.targetLevel + "×" + (s.requiredCount != null ? s.requiredCount : "?") + "人");
    const info = el("div", { class: "grow" }, [el("div", { text: s.item || "(中分類なし)" }), el("div", { class: "sub", text: [s.description, meta.join(" / ")].filter(Boolean).join("　") })]);
    return el("div", { class: "skill-list-item" }, [
      labeled("表示", visChk), labeled("コア", coreChk), info,
      ui.button("編集", { variant: "btn-ghost", onClick: () => editSkill(s) }),
      ui.button("削除", { variant: "btn-ghost", onClick: () => MK.ui.confirm("このスキルを削除しますか？").then((ok) => { if (ok) { L().removeSkill(s.id); render(); } }) }),
    ]);
  }
  function labeled(label, ctrl) { return el("label", { class: "sub", style: "display:flex;align-items:center;gap:var(--space-xxs);" }, [ctrl, label]); }

  function editSkill(s) {
    const f = {
      domain: ui.input({ value: s ? s.domain : "" }), item: ui.input({ value: s ? s.item : "" }), description: ui.input({ value: s ? s.description : "" }),
      core: ui.checkbox(s ? !!s.core : false), target: ui.input({ type: "number", value: s && s.targetLevel != null ? s.targetLevel : "" }),
      required: ui.input({ type: "number", value: s && s.requiredCount != null ? s.requiredCount : "" }), visible: ui.checkbox(s ? s.visible !== false : true),
    };
    MK.ui.modal({ title: s ? "スキルを編集" : "スキルを追加", body: ui.stack([
      ui.field("大分類（領域）", f.domain), ui.field("中分類（スキル項目）", f.item), ui.field("小分類（説明）", f.description),
      ui.field("コアスキル", f.core), ui.field("目標レベル（コア・1〜5）", f.target), ui.field("必要人数（コア）", f.required), ui.field("一覧・可視化に表示", f.visible),
    ]), actions: [
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => {
          if (!f.item.value.trim()) { MK.ui.toast("中分類（スキル項目）を入力してください", "error"); return; }
          const patch = { domain: f.domain.value.trim(), item: f.item.value.trim(), description: f.description.value.trim(), core: f.core.checked, visible: f.visible.checked,
            targetLevel: f.core.checked && f.target.value !== "" ? L().clampLv(f.target.value) : null,
            requiredCount: f.core.checked && f.required.value !== "" ? Math.max(0, parseInt(f.required.value, 10) || 0) : null };
          if (s) L().updateSkill(s.id, patch); else L().addSkill(patch);
          c(); render();
        } },
    ] });
  }

  function renderMatrix() {
    const ms = L().members(), vs = L().visibleSkills();
    const bar = ui.toolbar([
      ui.button("紐づけCSV出力", { onClick: () => { MK.io.downloadText("skill-ratings-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(L().buildRatingsCSVRows()), "text/csv"); MK.ui.toast("紐づけCSVを書き出しました", "success"); } }),
      ui.button("紐づけCSV取込", { onClick: () => MK.io.pickCsvFile((rows) => { const r = L().applyRatingsCSV(rows); render(); MK.ui.toast("取込 " + r.ok + " 件 / スキップ " + r.skip + " 件", r.skip ? "info" : "success"); }) }),
    ]);
    let content;
    if (!ms.length) content = membersEmpty("スキルを紐づけるには、まず「人の管理」でメンバーを登録してください。");
    else if (!vs.length) content = ui.emptyState("表示中のスキルがありません。");
    else {
      const hint = el("div", { class: "sub mk-muted", style: "margin-bottom:6px;", text: "数字をクリックしてレベルを設定（同じ数字を再クリックで解除）。右端「対象外」は評価対象外。色が濃いほど高レベル。" });
      content = el("div", {}, [hint, matrixTable(ms, vs, (m, s) => el("td", { class: "mk-rate-td" }, [rateCell(m.id, s.id)]))]);
    }
    root.appendChild(ui.stack([bar, content]));
  }
  // セル ＝ 1〜5／対象外 のセグメント。1クリックで即設定（同値の再クリックで解除）。
  function rateCell(mid, sid) {
    const cur = L().rating(mid, sid); // "" / "1"〜"5" / "-"
    const grp = el("div", { class: "mk-rate2" });
    const seg = (val, label) => {
      const b = el("button", { class: "mk-seg" + (val === cur ? " is-sel" : "") + (val === "-" ? " mk-seg-na" : ""), type: "button", text: label, title: val === "-" ? "対象外" : ("レベル" + val) });
      if (val === cur) b.setAttribute("style", heatStyle(val)); // 選択中のみ配色（"-" は muted）
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = L().rating(mid, sid) === val ? "" : val; // 同値クリックでトグル解除
        L().setRating(mid, sid, next);
        grp.replaceWith(rateCell(mid, sid)); // そのセルだけ再描画（全体再描画せずスクロール維持）
      });
      return b;
    };
    ["1", "2", "3", "4", "5"].forEach((v) => grp.appendChild(seg(v, v)));
    grp.appendChild(seg("-", "対象外"));
    return grp;
  }

  // 共通のマトリクス表（セル生成を cellFn に委譲）
  function matrixTable(ms, vs, cellFn) {
    const wrap = el("div", { class: "mk-matrix-wrap" });
    const table = el("table", { class: "mk-matrix" });
    table.appendChild(el("tr", {}, [el("th", { class: "rowhead", text: "スキル＼メンバー" })].concat(ms.map((m) => el("th", { text: m.name })))));
    L().domainsOrder(vs).forEach((dom) => {
      table.appendChild(el("tr", { class: "domain-row" }, [el("td", { class: "rowhead", colspan: String(ms.length + 1), text: dom || "(大分類なし)" })]));
      vs.filter((s) => s.domain === dom).forEach((s) => {
        const tr = el("tr", { class: s.core ? "core" : "" });
        tr.appendChild(el("td", { class: "rowhead", title: s.description || "", text: s.item }));
        ms.forEach((m) => tr.appendChild(cellFn(m, s)));
        table.appendChild(tr);
      });
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderDashboard() {
    const vs = L().visibleSkills(), ms = L().members();
    if (!vs.length || !ms.length) { root.appendChild(ui.emptyState("スキルとメンバーを登録すると可視化されます。")); return; }

    const heatCard = ui.card([el("h3", { text: "スキルマトリクス（ヒートマップ）" }), matrixTable(ms, vs, (m, s) => { const v = L().rating(m.id, s.id); return el("td", { class: "mk-heat", style: heatStyle(v), text: v === "" ? "" : v }); })]);

    const sumCard = ui.card([el("h3", { text: "スキル別 平均レベル / 保有人数（Lv3以上）" })]);
    vs.forEach((s) => {
      const avg = L().avgLevel(s.id), hold = L().countAtLeast(s.id, 3);
      sumCard.appendChild(el("div", { class: "mk-barline" }, [
        el("div", { class: "sub", text: s.item + "：平均 " + avg.toFixed(1) + " / Lv3以上 " + hold + "人" }),
        el("div", { class: "progress" }, [el("i", { style: "width:" + (avg / 5 * 100) + "%;" })]),
      ]));
    });

    const gapCard = ui.card([el("h3", { text: "スキルギャップ（コアスキル）" })]);
    const cores = vs.filter((s) => s.core);
    if (!cores.length) gapCard.appendChild(el("div", { class: "sub mk-muted", text: "コアスキルが指定されていません。" }));
    else {
      cores.map((s) => ({ s, g: L().gapOf(s) })).sort((a, b) => (b.g.shortage || 0) - (a.g.shortage || 0)).forEach(({ s, g }) => {
        let txt, cls;
        if (g.state === "unset") { txt = "目標未設定"; cls = "mk-muted"; }
        else if (g.state === "short") { txt = "不足 " + g.shortage + "人（充足 " + g.sufficient + "/" + g.required + "・目標Lv" + g.target + "）"; cls = "gap-short"; }
        else { txt = "充足（" + g.sufficient + "/" + g.required + "・目標Lv" + g.target + "）"; cls = "gap-ok"; }
        gapCard.appendChild(el("div", { class: "skill-list-item" }, [el("div", { class: "grow", text: s.item }), el("div", { class: cls, text: txt })]));
      });
    }
    root.appendChild(ui.stack([heatCard, sumCard, gapCard]));
  }

  // レーダー: メンバーを選ぶと、その人のスキル評価を多角形で可視化する（複数選択で比較）。
  function renderRadar() {
    const ms = L().members();
    if (!ms.length) { root.appendChild(membersEmpty("レーダーチャートで可視化するには、まず「人の管理」でメンバーを登録してください。")); return; }
    const vs = L().visibleSkills();
    if (vs.length < 3) {
      root.appendChild(ui.emptyState({ title: "スキルが足りません", hint: "レーダーチャートには表示対象のスキルが3つ以上必要です。「スキル管理」タブでスキルを追加してください。" }));
      return;
    }
    // 選択状態を初期化・整合（削除済みメンバーを除外し、最低1人は選ぶ）。
    if (!radarSel) radarSel = new Set([ms[0].id]);
    radarSel = new Set(ms.filter((m) => radarSel.has(m.id)).map((m) => m.id));
    if (!radarSel.size) radarSel.add(ms[0].id);

    const colorFor = (mid) => RADAR_COLORS[Math.max(0, ms.findIndex((m) => m.id === mid)) % RADAR_COLORS.length];

    const picker = el("div", { class: "mk-radar-picker" }, ms.map((m) => {
      const on = radarSel.has(m.id);
      const dot = el("span", { class: "mk-radar-dot" }); dot.style.background = colorFor(m.id);
      const b = el("button", { class: "mk-chip-toggle" + (on ? " is-on" : ""), type: "button", "aria-pressed": on ? "true" : "false" }, [dot, el("span", { text: m.name })]);
      b.addEventListener("click", () => {
        if (radarSel.has(m.id)) { if (radarSel.size > 1) radarSel.delete(m.id); } // 最後の1人は残す
        else radarSel.add(m.id);
        render();
      });
      return b;
    }));

    const data = L().radarData(ms.filter((m) => radarSel.has(m.id)).map((m) => m.id));
    const chart = el("div", { class: "mk-radar-wrap" });
    chart.innerHTML = radarSVG(data, colorFor);
    const legend = el("div", { class: "mk-radar-legend" }, data.series.map((se) => {
      const dot = el("span", { class: "mk-radar-dot" }); dot.style.background = colorFor(se.id);
      return el("span", { class: "mk-radar-legend-item" }, [dot, el("span", { text: se.name + "（評価 " + se.rated + "/" + data.axes.length + "）" })]);
    }));
    const card = ui.card([picker, chart, legend]);
    if (!data.hasRating) card.appendChild(el("div", { class: "mk-radar-note", text: "選択中のメンバーにはまだ評価がありません。「紐づけ（評価入力）」タブで評価を入力してください。" }));
    root.appendChild(card);
  }

  // レーダーチャートSVG。軸＝スキル、値0〜5。系列色は colorFor(memberId) から取得（CSS変数でテーマ追従）。
  function radarSVG(data, colorFor) {
    const esc = MK.util.escapeHtml;
    const W = 440, H = 440, cx = W / 2, cy = H / 2, R = 150, N = data.axes.length, max = data.max;
    const ang = (i) => (-90 + i * 360 / N) * Math.PI / 180;
    const px = (i, r) => (cx + Math.cos(ang(i)) * r).toFixed(1);
    const py = (i, r) => (cy + Math.sin(ang(i)) * r).toFixed(1);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="スキル評価のレーダーチャート">';
    for (let lv = 1; lv <= max; lv++) {
      const pts = [];
      for (let i = 0; i < N; i++) pts.push(px(i, R * lv / max) + "," + py(i, R * lv / max));
      s += '<polygon points="' + pts.join(" ") + '" fill="none" stroke="var(--color-hairline)" stroke-width="1"></polygon>';
    }
    for (let i = 0; i < N; i++) {
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + px(i, R) + '" y2="' + py(i, R) + '" stroke="var(--color-hairline)" stroke-width="1"></line>';
      const c = Math.cos(ang(i));
      const anchor = Math.abs(c) < 0.3 ? "middle" : (c > 0 ? "start" : "end");
      const lbl = data.axes[i].label || "";
      const short = lbl.length > 8 ? lbl.slice(0, 8) + "…" : lbl;
      s += '<text x="' + px(i, R + 16) + '" y="' + (Number(py(i, R + 16)) + 4).toFixed(1) + '" text-anchor="' + anchor + '" font-size="11" fill="var(--color-steel)"><title>' + esc(lbl) + '</title>' + esc(short) + '</text>';
    }
    data.series.forEach((se) => {
      const col = colorFor(se.id), pts = [];
      for (let i = 0; i < N; i++) pts.push(px(i, R * (se.values[i] || 0) / max) + "," + py(i, R * (se.values[i] || 0) / max));
      s += '<polygon points="' + pts.join(" ") + '" fill="' + col + '" fill-opacity="0.12" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"></polygon>';
      for (let i = 0; i < N; i++) { if (!se.values[i]) continue; s += '<circle cx="' + px(i, R * se.values[i] / max) + '" cy="' + py(i, R * se.values[i] / max) + '" r="3" fill="' + col + '"></circle>'; }
    });
    return s + "</svg>";
  }

  function heatStyle(v) {
    if (v === "-") return "background:var(--color-surface);color:var(--color-muted);";
    if (!v) return "";
    const a = { 1: 0.16, 2: 0.33, 3: 0.5, 4: 0.7, 5: 0.9 }[Number(v)] || 0;
    return "background:rgba(var(--color-primary-rgb)," + a + ");color:" + (Number(v) >= 3 ? "var(--color-on-primary)" : "var(--color-ink)") + ";";
  }

  MK.registerModule("skills", {
    title: "スキル", icon: "📊",
    description: "メンバーのスキルを一覧で可視化する",
    mount(container, c) { ctx = c; root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; ctx = null; },
    summary() { return L().summary(); },
    summaryFor(entityType, id) { return L().summaryFor(entityType, id); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
