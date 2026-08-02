/* モジュール metrics — ビュー（描画・イベント）。計算/CRUD は MK.logic.metrics に委譲。CONVENTIONS §1 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const ui = MK.ui;
  const L = () => MK.logic.metrics;

  let root = null;

  function render() {
    if (!root) return;
    root.innerHTML = "";
    root.appendChild(ui.sectionTitle("プロダクト指標（KGI / NSM / KPI）"));

    const list = L().metrics();

    // カード指標（表示中プロダクト単位）。母数の羅列を避け、達成状況を主に出す。
    const measured = list.filter((m) => L().achievement(m));
    const met = measured.filter((m) => L().achievement(m).met).length;
    const noRecord = list.filter((m) => !m.records || !m.records.length).length;
    const stats = ui.statsRow([
      { num: list.length, label: "指標数" },
      { num: measured.length ? met + "/" + measured.length : "—", label: "達成（目標達成/計測中）" },
      { num: noRecord, label: "未記録" },
    ]);

    const bar = ui.toolbar([
      ui.button("＋ 指標を追加", { variant: "btn-primary", onClick: () => openEditor(null) }),
    ]);

    if (!list.length) {
      root.appendChild(ui.stack([stats, bar, ui.emptyState({
        title: "まだ指標がありません",
        hint: "KGI（最上位のビジネス目標）→ NSM（北極星指標）→ KPI（支える先行/遅行指標）を木で整理し、期間ごとに実績を記録して達成度を追います。",
        action: { label: "＋ 最初の指標を追加", onClick: () => openEditor(null) },
      })]));
      return;
    }

    const listHost = ui.card([], { flush: true });
    renderTree(listHost, list);
    root.appendChild(ui.stack([stats, bar, listHost]));
  }

  // 指標の削除（確認なし＋取り消しトースト・CONVENTIONS §2.5-3）。
  // confirm で伝えていた「子指標は親へ引き上げます」は、事後のトースト本文で伝える（#283）。
  // 引き上げ件数は削除前にしか数えられないので先に取る。undo は引き上げも巻き戻す。
  function removeMetricWithUndo(metric) {
    const lifted = L().childrenOf(L().metrics(), metric.id).length;
    const removed = L().removeMetric(metric.id);
    render(); // 空振り（既に消えている）でも画面をストアへ合わせ直す
    if (!removed) return; // 空振りでトーストを出すと、その取り消しが別の1件を復元しかねない
    const suffix = lifted ? "（子指標" + lifted + "件を親へ移動）" : "";
    MK.ui.undoDeleteToast("「" + metric.name + "」を削除しました" + suffix, () => L().undoDelete(), render);
  }

  function renderTree(host, list) {
    host.innerHTML = "";
    const ul = el("ul", { class: "mk-list" });
    L().tree(list).forEach((row) => ul.appendChild(itemRow(row.node, row.depth)));
    host.appendChild(ul);
  }

  function itemRow(m, depth) {
    const meta = [];
    meta.push(el("span", { class: "chip", text: kindLabel(m.kind) }));
    if (m.unit) meta.push(el("span", { class: "sub", text: "単位 " + m.unit }));
    meta.push(el("span", { class: "sub", text: dirLabel(m.direction) }));
    if (m.targetValue !== null && m.targetValue !== undefined) meta.push(el("span", { class: "sub", text: "目標 " + m.targetValue }));

    const latest = L().latestRecord(m);
    const ach = L().achievement(m);
    if (latest) {
      let text = "実績 " + latest.value + "（" + latest.period + "）";
      if (ach) text += ach.met ? " ✓達成" : " 未達";
      if (ach && ach.ratio !== null) text += " " + Math.round(ach.ratio * 100) + "%";
      meta.push(el("span", { class: "chip" + (ach ? (ach.met ? " chip-success" : " chip-warn") : ""), text: text }));
    } else {
      meta.push(el("span", { class: "sub", text: "実績未記録" }));
    }
    if (m.note) meta.push(el("span", { class: "sub", text: m.note }));

    const title = el("div", {}, [el("span", { text: m.name })]);
    // depth ぶんインデントして KGI→NSM→KPI の階層を視認できるようにする（14px/段。wbs のツリーと同じ流儀）。
    const grow = el("div", { class: "grow", style: "cursor:pointer;padding-left:" + (depth * 14) + "px;" }, [title, el("div", { class: "sub" }, meta)]);
    grow.addEventListener("click", () => openEditor(m));
    return el("li", { class: "mk-row" }, [grow]);
  }

  function kindLabel(kind) { const k = L().KINDS.find((x) => x.key === kind); return k ? k.label : kind; }
  function dirLabel(dir) { const d = L().DIRECTIONS.find((x) => x.key === dir); return d ? d.label : dir; }

  /**
   * 指標の追加/編集モーダルを開く。metric=null で新規追加。
   * 既存編集のときだけ実績（records）の管理セクションを出す（新規は指標作成が先）。
   */
  function openEditor(metric) {
    const isNew = !metric;
    const list = L().metrics();
    // 親候補: 自分自身と自分の子孫は循環になるため除く（新規は全指標が候補）。
    const exclude = {};
    if (metric) { exclude[metric.id] = true; L().descendantsOf(list, metric.id).forEach((id) => { exclude[id] = true; }); }
    const parentOptions = [{ value: "", label: "（親なし・トップ）" }].concat(
      list.filter((x) => !exclude[x.id]).map((x) => ({ value: x.id, label: kindLabel(x.kind) + "： " + x.name })));

    const f = {};
    f.name = ui.input({ value: metric ? metric.name : "", placeholder: "例: 週次アクティブ利用者数（WAU）" });
    f.kind = ui.select(L().KINDS.map((k) => ({ value: k.key, label: k.label })), metric ? metric.kind : "kpi");
    f.unit = ui.input({ value: metric ? metric.unit : "", placeholder: "例: %, 円, 人, 件/月" });
    f.direction = ui.select(L().DIRECTIONS.map((d) => ({ value: d.key, label: d.label })), metric ? metric.direction : "up");
    f.targetValue = ui.input({ type: "number", value: metric && metric.targetValue !== null && metric.targetValue !== undefined ? metric.targetValue : "" });
    f.parentId = ui.select(parentOptions, metric ? (metric.parentId || "") : "");
    f.note = ui.textarea(metric ? metric.note : "");

    const sections = [
      ui.field("指標名", f.name),
      ui.field("種別", f.kind),
      ui.field("単位", f.unit),
      ui.field("方向", f.direction),
      ui.field("目標値", f.targetValue),
      ui.field("親指標", f.parentId),
      ui.field("メモ", f.note),
    ];

    // 実績（records）セクション: 既存指標のみ。追加/削除は即時保存し、その場で一覧を再描画する。
    if (!isNew) {
      const recHost = el("div");
      renderRecords(recHost, metric.id);
      sections.push(ui.field("実績（期間ごと）", recHost));
    }

    const body = ui.stack(sections);

    const actions = [];
    if (!isNew) {
      // 削除は確認を挟まず即実行し、取り消しトーストを出す（CONVENTIONS §2.5-3）。先にモーダルを
      // 閉じてから出す（モーダルの裏にトーストが隠れないように）。
      actions.push({ label: "削除", variant: "btn-danger", onClick: (close) => { close(); removeMetricWithUndo(metric); } });
    }
    actions.push({ label: "キャンセル", variant: "btn-secondary", onClick: (close) => close() });
    actions.push({ label: "保存", variant: "btn-primary", onClick: (close) => {
      const name = f.name.value.trim();
      if (!name) { MK.ui.toast("指標名を入力してください", "error"); return; }
      const attrs = {
        name: name, kind: f.kind.value, unit: f.unit.value, direction: f.direction.value,
        targetValue: f.targetValue.value, note: f.note.value,
      };
      if (isNew) {
        const created = L().addMetric(attrs);
        // 親は addMetric でも受けるが、循環防止の一元管理のため setParent を通す（新規は循環しないが経路を1つに）。
        if (created && f.parentId.value) L().setParent(created.id, f.parentId.value);
      } else {
        L().updateMetric(metric.id, attrs);
        if (!L().setParent(metric.id, f.parentId.value || null)) {
          // 循環する親指定は setParent が false を返す。スカラー更新は済んでいるので理由だけ知らせる。
          MK.ui.toast("その指標は子孫のため親に設定できません", "error");
        }
      }
      close(); render();
    } });

    MK.ui.modal({ title: isNew ? "指標を追加" : "指標を編集", body, actions });
  }

  // 実績一覧＋追加フォーム。host の中身を差し替える形で再描画する（モーダルを開いたまま追加/削除できる）。
  function renderRecords(host, metricId) {
    host.innerHTML = "";
    const m = L().metrics().find((x) => x.id === metricId);
    if (!m) return;
    const records = L().sortedRecords(m);
    if (records.length) {
      const ul = el("ul", { class: "mk-list" });
      records.forEach((r) => {
        const label = el("div", { class: "grow" }, [el("span", { text: r.period + "： " + r.value })]);
        const del = ui.button("削除", { variant: "btn-ghost", onClick: () => { L().removeRecord(metricId, r.period); renderRecords(host, metricId); } });
        ul.appendChild(el("li", { class: "mk-row" }, [label, del]));
      });
      host.appendChild(ul);
    } else {
      host.appendChild(el("div", { class: "sub", text: "まだ実績がありません。期間と値を入れて追加してください。" }));
    }
    const period = ui.input({ placeholder: "期間 例: 2026-07 / 2026-Q3" });
    const value = ui.input({ type: "number", placeholder: "実績値" });
    const add = ui.button("＋ 実績を追加", { onClick: () => {
      if (!L().setRecord(metricId, period.value, value.value)) { MK.ui.toast("期間と数値の実績値を入力してください", "error"); return; }
      renderRecords(host, metricId);
    } });
    host.appendChild(ui.toolbar([period, value, add]));
  }

  MK.registerModule("metrics", {
    title: "プロダクト指標",
    icon: "🎯",
    description: "プロダクトの KGI / NSM / KPI を木で整理し実績と達成度を追う",
    // Product 次元に属する scoped モジュール（§3.7.3）。シェルが現在のプロダクトの対象別 store を
    // ctx.store で渡してくるので、それに束ねてから描画する（wbs が project 次元でやるのと同じ要領）。
    scope: { dim: "product" },
    mount(container, ctx) {
      if (ctx && ctx.store) L().setStore(ctx.store);
      root = el("div"); container.appendChild(root);
      render();
    },
    unmount() { root = null; },
    summary() { return L().summary(); },
    // 全プロダクト横断（§3.7.4）: 検索は表示中プロダクトに限らず全プロダクトを走査する。
    searchItems() { return L().searchItems(); },
    // 対象別 scope（§3.7.4）: io がプロダクトごとに targetId を渡す。省略時は表示中の store。
    exportData(targetId) { return L().exportData(targetId); },
    importData(data, mode, targetId) { L().importData(data, mode, targetId); },
    // 投入先を指定できる（シェルのサンプル投入バーが表示中のプロダクトを渡す。Issue #256）。
    // 省略時は自分の次元の既定対象（先頭プロダクト・無ければ作成）へ寄せる（§3.7.6）。
    loadSample(targetId) {
      if (targetId) { L().loadSample(targetId); return; }
      const dim = MK.scope.dimOf(this.scope);
      L().loadSample(dim ? MK.scope.ensureDefaultTarget(dim) : null);
    },
  });
})();
