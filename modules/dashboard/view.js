/* モジュール dashboard（プロジェクト・ダッシュボード＝横断集約ビュー）— ビュー（描画・遷移）。集約計算は MK.logic.dashboard に委譲。CONVENTIONS §1
   project-scoped モジュール（spec §3.7.3）。シェルのスコープスイッチャで選んだ Project を主語に、基本情報・WBS 進捗・
   アサイン状況・関連プロダクトを1画面で一望する。読み取り専用の集約に留め、編集は各カードの導線から各モジュールへ
   遷移して行う（ctx.route）。データが無い領域は空状態の案内を出す（Issue #78）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.dashboard;

  let root = null;
  let ctx = null;

  // カード内のブロック間隔は mk-stack（縦リズム）に委ねる（CONVENTIONS §2.1）。
  // .card 直下は h3 / .sub にしか自動間隔が付かないため、任意ブロックを積むときは stack で包む。
  // 特に「開く →」等の末尾アクションは、margin-bottom を持つ mk-toolbar（先頭ツールバー用）で
  // 包むと上が密着し下に死に余白が出る。stack の一員として直接置く（末尾に margin-bottom を作らない）。
  function card(children) { return ui.card([ui.stack(children)]); }

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("ダッシュボード"));
    // scoped モジュールは通常 ctx.scope が入るが、防御的に未設定でも壊さない。
    const scope = ctx && ctx.scope;
    if (!scope || !scope.entity) {
      root.appendChild(ui.emptyState("プロジェクトが選択されていません。「プロジェクト」マスタで作成してください。"));
      return;
    }
    const projectId = scope.id;
    const today = MK.util.todayISO();
    root.appendChild(ui.stack([
      infoCard(scope.entity),
      wbsCard(L().wbsSummary(projectId, today)),
      allocationCard(L().allocationsFor(projectId, today)),
      productsCard(L().productsFor(projectId)),
    ]));
  }

  // 別モジュールへ遷移する（ctx.route）。project-scoped 同士（wbs）は現在の PJ 文脈を引き継ぐ。
  function goTo(view) { if (ctx && typeof ctx.route === "function") ctx.route(view); }

  // ---- プロジェクト基本情報（マスタ: ステータス等）----
  function infoCard(project) {
    const meta = [el("span", { class: "chip", text: L().projectStatusLabel(project.status) })];
    if (project.color) meta.unshift(el("span", {
      style: "display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:" + project.color + ";vertical-align:middle;",
    }));
    const kids = [
      el("h3", { text: "プロジェクト" }),
      el("div", { style: "font-weight:600;", text: project.name }),
      el("div", { class: "sub" }, meta),
    ];
    if (project.note) kids.push(el("p", { class: "sub", text: project.note }));
    return card(kids);
  }

  // ---- WBS の進捗サマリ（タスク数・完了率・期限超過）----
  function wbsCard(s) {
    const kids = [el("h3", { text: "WBS の進捗" })];
    if (s.empty) {
      kids.push(ui.emptyState("このプロジェクトの WBS にタスクがありません。"));
    } else {
      kids.push(ui.statsRow([
        { num: s.overall + "%", label: "進捗" },
        { num: s.leaves, label: "タスク" },
        { num: s.done, label: "完了" },
        { num: s.inprogress, label: "進行中" },
        { num: s.overdue, label: "期限超過" },
      ]));
      if (s.overdue > 0) kids.push(el("p", { class: "sub", style: "color:var(--color-error);", text: "⚠ 期限を過ぎた未完タスクが " + s.overdue + " 件あります。" }));
    }
    kids.push(ui.button("WBS を開く →", { variant: "btn-secondary", onClick: () => goTo("wbs") }));
    return card(kids);
  }

  // ---- アサイン状況（共有アロケーション: 誰が何%か）----
  function allocationCard(rows) {
    const kids = [el("h3", { text: "アサイン状況" })];
    if (!rows.length) {
      kids.push(ui.emptyState("このプロジェクトへのアロケーションがありません。"));
    } else {
      const ul = el("ul", { class: "mk-list" });
      rows.forEach((r) => {
        const period = (r.allocation.startDate || "?") + " 〜 " + (r.allocation.endDate || "?");
        const badge = r.active ? el("span", { class: "chip", text: "稼働中" }) : el("span", { class: "sub", text: "期間外" });
        const info = el("div", { class: "grow" }, [
          el("div", { text: r.memberName + "　" + r.allocation.percent + "%" }),
          el("div", { class: "sub", text: period }),
        ]);
        ul.appendChild(el("li", { class: "mk-row" }, [info, badge]));
      });
      kids.push(ul);
    }
    kids.push(ui.button("リソースを開く →", { variant: "btn-secondary", onClick: () => goTo("resource") }));
    return card(kids);
  }

  // ---- 関連プロダクト（Product との紐付け・Issue #55）----
  function productStatusLabel(key) {
    const s = MK.products && (MK.products.STATUSES || []).find((x) => x.key === key);
    return s ? s.label : key;
  }
  function productsCard(list) {
    const kids = [el("h3", { text: "関連プロダクト" })];
    if (!list.length) {
      kids.push(ui.emptyState("このプロジェクトに紐づくプロダクトがありません。「プロダクト」マスタで関連付けできます。"));
    } else {
      const ul = el("ul", { class: "mk-list" });
      list.forEach((p) => {
        const meta = [el("span", { class: "chip", text: productStatusLabel(p.status) })];
        if (p.summary) meta.push(el("span", { class: "sub", text: p.summary }));
        ul.appendChild(el("li", { class: "mk-row" }, [
          el("div", { class: "grow" }, [el("div", { text: p.name }), el("div", { class: "sub" }, meta)]),
        ]));
      });
      kids.push(ul);
    }
    return card(kids);
  }

  MK.registerModule("dashboard", {
    title: "ダッシュボード", icon: "🧭",
    description: "プロジェクトの状況をまとめて俯瞰する",
    scope: { dim: "project" },
    mount(container, context) { ctx = context; root = el("div"); container.appendChild(root); render(); },
    unmount() { root = null; ctx = null; },
  });
})();
