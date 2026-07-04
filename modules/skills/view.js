/* モジュール skills — ビュー（描画・イベント）。計算/取込は MK.logic.skills に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.skills;

  let root = null;
  let view = "matrix";

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("スキル"));
    root.appendChild(ui.pillTabs([{ key: "skills", label: "スキル管理" }, { key: "matrix", label: "紐づけ（評価入力）" }, { key: "dashboard", label: "ダッシュボード" }], view, (k) => { view = k; render(); }));
    if (view === "skills") renderSkillsTab();
    else if (view === "matrix") renderMatrix();
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
    if (!list.length) content = ui.emptyState("スキルがありません。「＋ スキルを追加」から登録してください。");
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
  function labeled(label, ctrl) { return el("label", { class: "sub", style: "display:flex;align-items:center;gap:4px;" }, [ctrl, label]); }

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
    if (!ms.length) content = ui.emptyState("メンバーがいません。「人の管理」で追加してください。");
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

  function heatStyle(v) {
    if (v === "-") return "background:var(--color-surface);color:var(--color-muted);";
    if (!v) return "";
    const a = { 1: 0.16, 2: 0.33, 3: 0.5, 4: 0.7, 5: 0.9 }[Number(v)] || 0;
    return "background:rgba(86,69,212," + a + ");color:" + (Number(v) >= 3 ? "#fff" : "var(--color-ink)") + ";";
  }

  MK.registerModule("skills", {
    title: "スキル", icon: "📊",
    mount(container) { root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; },
    summary() { return L().summary(); },
    exportData() { return L().exportData(); },
    importData(data, mode) { L().importData(data, mode); },
    loadSample() { L().loadSample(); },
  });
})();
