/* シェル：マスタ管理（人＝ピープル / プロジェクト＝デリバリー / プロダクト。spec §6.4）と
   人の詳細（集約ビュー。Issue #83）。shell-core 等の後に読む（Issue #140）。
   マスタ CRUD の同型部分は renderMaster に共通化し、固有部分だけ cfg で差し込む（Issue #138）。
   定数・main・ルーターは S（window.MK.shell）経由。開いている人詳細 personId は S.peopleDetailId で共有する。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { META, ALLOWED, main } = S;
  const { route, isHiddenModule } = S;

  function renderPeopleView() {
    // 詳細を開いている場合はそちらを描画（対象が削除されていたら一覧へ退避）。
    if (S.peopleDetailId) {
      const person = MK.people.get(S.peopleDetailId);
      if (person) { renderPersonDetail(person); return; }
      S.peopleDetailId = null;
    }
    main.appendChild(el("h2", { class: "mk-section-title", text: "👤 人（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderPeople(body);
  }
  function renderProjectsView() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "📁 プロジェクト（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderProjects(body);
  }

  // ---- 人の詳細（関連情報の集約ビュー。Issue #83 / spec §3.6.1・§9.5）----
  // その人に紐づく各モジュールの概況を「読み取り専用の集約＋各モジュールへの遷移」で一望する。
  // 各枠は他モジュールをハード参照せず MK.readEntitySummary（"person", personId）経由で問い合わせる。
  //  - null（未搭載・未ロード・summaryFor 未実装・例外）→ 枠を黙って省く（疎結合。§9.5 保証3）
  //  - { empty: true } → 枠は出すが空状態案内（該当データ無し）
  //  - stats あり → 集約値を表示し、該当モジュールへ「開く →」で遷移
  // プロジェクト側の集約は dashboard（#78・project-scoped）が担い、ここでは重複させない（§9.6 判断記録）。
  function renderPersonDetail(person) {
    main.appendChild(el("h2", { class: "mk-section-title", text: "👤 " + person.name }));
    const back = el("button", { class: "btn btn-ghost", text: "← 人マスタ一覧へ" });
    back.addEventListener("click", () => { S.peopleDetailId = null; route("master-people"); });
    main.appendChild(el("div", { class: "mk-toolbar" }, [back]));

    const cards = [personInfoCard(person)];
    // 登録済みモジュールを表示順（moduleOrder）に走査。非表示モジュールは集約から除く（要対応帯と同様）。
    MK.moduleOrder.forEach((id) => {
      if (isHiddenModule(id)) return;
      const sum = MK.readEntitySummary(id, "person", person.id);
      if (!sum) return;                       // 未搭載/未実装/例外 → 枠を黙って省く（疎結合）
      cards.push(personSummaryCard(id, sum));
    });
    const prod = personProductsCard(person);  // 関連プロダクト（owner）。products マスタ未ロードなら null
    if (prod) cards.push(prod);
    main.appendChild(el("div", { class: "mk-stack" }, cards));
  }

  // 人の基本情報（マスタ: 役割・備考・表示色）＋編集導線。
  function personInfoCard(person) {
    const meta = [];
    if (person.color) meta.push(el("span", {
      style: "display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:" + person.color + ";vertical-align:middle;",
    }));
    if (person.role) meta.push(el("span", { class: "chip", text: person.role }));
    const kids = [el("h3", { text: "基本情報" }), el("div", { style: "font-weight:600;", text: person.name })];
    if (meta.length) kids.push(el("div", { class: "sub" }, meta));
    if (person.note) kids.push(el("p", { class: "sub", text: person.note }));
    const edit = el("button", { class: "btn btn-secondary", text: "編集" });
    // 一覧からの編集と同じモーダル。保存後は masters:changed で詳細/一覧が再描画される（editMember に統合・Issue #138）。
    edit.addEventListener("click", () => editMember(person));
    kids.push(edit);
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // 1モジュール分の集約カード（summary() と同型の { empty, stats, attention? } を描画）。
  function personSummaryCard(id, sum) {
    const meta = META[id] || {};
    const kids = [el("h3", { text: (meta.icon ? meta.icon + " " : "") + (meta.title || id) })];
    if (sum.empty || !Array.isArray(sum.stats) || !sum.stats.length) {
      kids.push(MK.ui.emptyState("この人の" + (meta.title || "データ") + "はまだありません。"));
    } else {
      kids.push(MK.ui.statsRow(sum.stats.map((s) => ({ num: s.value, label: s.label }))));
    }
    if (Array.isArray(sum.attention)) {
      sum.attention.forEach((a) => { if (a && a.label) kids.push(el("p", { class: "sub", style: "color:var(--color-error);", text: "⚠ " + a.label })); });
    }
    // 遷移導線は集約ビュー側が組み立てる（契約には持たせない・§3.6.1）。到達可能なモジュールのみ。
    if (ALLOWED[id] && !isHiddenModule(id)) {
      const go = el("button", { class: "btn btn-secondary", text: (meta.title || id) + " を開く →" });
      go.addEventListener("click", () => route(id));
      kids.push(go);
    }
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // 関連プロダクト（owner。Product マスタ・§4.4）。products は共有マスタのため MK.products を直接参照する
  // （モジュールではないので readEntitySummary の対象外）。未ロード（member 配布等）なら枠ごと出さない。
  function personProductsCard(person) {
    if (!MK.products) return null;
    const owned = MK.products.all().filter((p) => p.ownerId === person.id);
    const kids = [el("h3", { text: "📦 関連プロダクト（オーナー）" })];
    if (!owned.length) {
      kids.push(MK.ui.emptyState("この人がオーナーのプロダクトはありません。"));
    } else {
      const ul = el("ul", { class: "mk-list" });
      owned.forEach((p) => {
        const meta = [el("span", { class: "chip", text: productStatusLabel(p.status) })];
        if (p.summary) meta.push(el("span", { class: "sub", text: p.summary }));
        ul.appendChild(el("li", { class: "mk-row" }, [
          el("div", { class: "grow" }, [el("div", { text: p.name }), el("div", { class: "sub" }, meta)]),
        ]));
      });
      kids.push(ul);
    }
    if (ALLOWED["master-products"]) {
      const go = el("button", { class: "btn btn-secondary", text: "プロダクトを開く →" });
      go.addEventListener("click", () => route("master-products"));
      kids.push(go);
    }
    return el("div", { class: "card" }, [el("div", { class: "mk-stack" }, kids)]);
  }

  // ---- マスタ CRUD の共通骨格（人／プロジェクト／プロダクト。Issue #138）----
  // 追加バー＋CSV 入出力＋一覧の同型部分を1本に寄せ、マスタ固有部分（API・ラベル・行描画・
  // 編集モーダル・絞り込みタブ）だけ cfg で差し込む。再描画は各マスタ操作が発火する
  // masters:changed（shell.js の bus ハンドラ）に一任し、手動の再描画コールバックは持たない。
  //   cfg.api          … マスタ本体（create/all/remove/buildCSVRows/applyCSV を持つ）
  //   cfg.list()       … 一覧に出す配列（絞り込み後。省略時は api.all()）
  //   cfg.addPlaceholder / cfg.addMaxWidth … 追加入力欄の文言・幅
  //   cfg.csvBase / cfg.exportToast / cfg.importToast(n) … CSV ファイル名接頭辞・トースト
  //   cfg.emptyText    … 0件時の文言
  //   cfg.renderInfo(item) … 行の左側（.grow）を作る（編集・削除ボタンは共通で付与）
  //   cfg.confirmText(item) / cfg.openEdit(item) … 削除確認文言・編集モーダル起動
  //   cfg.beforeList(container) … 一覧の前に差し込む任意 UI（例: 絞り込みタブ）
  //   cfg.onImport()   … CSV 取込後の副作用（例: 絞り込みを全件へ戻す）
  function renderMaster(container, cfg) {
    const bar = el("div", { class: "mk-toolbar" });
    const nameInput = el("input", { class: "text-input", placeholder: cfg.addPlaceholder, style: "max-width:" + cfg.addMaxWidth + ";" });
    const addBtn = el("button", { class: "btn btn-primary", text: "追加" });
    // create は masters:changed を発火し、bus ハンドラがビュー全体を再描画する（手動再描画は不要）。
    const add = () => { const n = nameInput.value.trim(); if (n) { cfg.api.create({ name: n }); nameInput.value = ""; } };
    addBtn.addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    bar.appendChild(nameInput); bar.appendChild(addBtn);
    const expBtn = el("button", { class: "btn btn-secondary", text: "CSV出力" });
    expBtn.addEventListener("click", () => {
      MK.io.downloadText(cfg.csvBase + "-" + MK.util.todayISO().replace(/-/g, "") + ".csv", MK.io.csv.stringify(cfg.api.buildCSVRows()), "text/csv");
      MK.ui.toast(cfg.exportToast, "success");
    });
    const impBtn = el("button", { class: "btn btn-secondary", text: "CSV取込" });
    // applyCSV は masters:changed を発火し、bus ハンドラがビュー全体を再描画する。
    impBtn.addEventListener("click", () => MK.io.pickCsvFile((rows) => {
      const n = cfg.api.applyCSV(rows);
      if (cfg.onImport) cfg.onImport();
      MK.ui.toast(cfg.importToast(n), "success");
    }));
    bar.appendChild(expBtn); bar.appendChild(impBtn);
    container.appendChild(bar);
    if (cfg.beforeList) cfg.beforeList(container);
    const host = el("div", { class: "card", style: "padding:0;overflow:hidden;" });
    container.appendChild(host);
    renderMasterList(host, cfg);
  }
  function renderMasterList(host, cfg) {
    host.innerHTML = "";
    const items = cfg.list ? cfg.list() : cfg.api.all();
    if (!items.length) { host.appendChild(el("div", { class: "mk-empty", text: cfg.emptyText })); return; }
    const ul = el("ul", { class: "mk-list" });
    items.forEach((item) => {
      const info = cfg.renderInfo(item);
      const edit = el("button", { class: "btn btn-ghost", text: "編集" });
      edit.addEventListener("click", () => cfg.openEdit(item));
      const del = el("button", { class: "btn btn-ghost", text: "削除" });
      // 削除も masters:changed 経由で再描画される（手動再描画は不要）。
      del.addEventListener("click", () => MK.ui.confirm(cfg.confirmText(item)).then((ok) => { if (ok) cfg.api.remove(item.id); }));
      ul.appendChild(el("li", { class: "mk-row" }, [info, edit, del]));
    });
    host.appendChild(ul);
  }
  // マスタ編集モーダルの共通骨格。fields=[{ label, build(f) }]（build は control を返しつつ f に参照を格納）、
  // onSave(f, close) が保存処理、extraActions(f) は「削除」等の先頭アクション（省略可）。
  function masterEditModal(spec) {
    const f = {};
    const body = el("div", {}, spec.fields.map((fd) => fld(fd.label, fd.build(f))));
    const actions = (spec.extraActions ? spec.extraActions(f) : []).concat([
      { label: "キャンセル", variant: "btn-secondary", onClick: (c) => c() },
      { label: "保存", variant: "btn-primary", onClick: (c) => spec.onSave(f, c) },
    ]);
    MK.ui.modal({ title: spec.title, body, actions });
  }

  // ---- 人の管理 ----
  function renderPeople(container) {
    renderMaster(container, {
      api: MK.people,
      addPlaceholder: "氏名を入力して追加",
      addMaxWidth: "260px",
      csvBase: "people",
      exportToast: "人マスタCSVを書き出しました",
      importToast: (n) => n + " 件のメンバーを取り込みました",
      emptyText: "メンバーがいません",
      confirmText: (m) => m.name + " を削除しますか？",
      openEdit: (m) => editMember(m),
      renderInfo: (m) => {
        // 氏名クリックで関連情報の集約ビュー（詳細）へ（Issue #83）。
        const nameLink = el("button", { class: "mk-linklike", text: m.name });
        nameLink.addEventListener("click", () => { S.peopleDetailId = m.id; route("master-people"); });
        return el("div", { class: "grow" }, [
          nameLink,
          el("div", { class: "sub", text: [m.role, m.note].filter(Boolean).join(" / ") }),
        ]);
      },
    });
  }
  // 一覧・詳細の両方から使う。保存後は masters:changed でビューが再描画されるため専用の再描画は不要（Issue #138）。
  function editMember(m) {
    masterEditModal({
      title: "メンバーを編集",
      fields: [
        { label: "氏名", build: (f) => (f.name = inp(m.name)) },
        { label: "役割", build: (f) => (f.role = inp(m.role)) },
        { label: "表示色", build: (f) => (f.color = inp(m.color, "color")) },
        { label: "備考", build: (f) => (f.note = inp(m.note)) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("氏名を入力してください", "error"); return; }
        MK.people.update(m.id, { name: f.name.value.trim(), role: f.role.value, color: f.color.value, note: f.note.value });
        c();
      },
    });
  }

  // ---- プロジェクト管理 ----
  const PROJECT_STATUSES = MK.projects.STATUSES;
  function projectStatusLabel(key) {
    return MK.projects.statusLabel(key);
  }
  function renderProjects(container) {
    renderMaster(container, {
      api: MK.projects,
      addPlaceholder: "プロジェクト名を入力して追加",
      addMaxWidth: "300px",
      csvBase: "projects",
      exportToast: "プロジェクトCSVを書き出しました",
      importToast: (n) => n + " 件のプロジェクトを取り込みました",
      emptyText: "プロジェクトがありません",
      confirmText: (p) => p.name + " を削除しますか？",
      openEdit: (p) => editProject(p),
      renderInfo: (p) => el("div", { class: "grow" }, [
        el("div", { text: p.name }),
        el("div", { class: "sub", text: projectStatusLabel(p.status) }),
      ]),
    });
  }
  function editProject(p) {
    masterEditModal({
      title: "プロジェクトを編集",
      fields: [
        { label: "プロジェクト名", build: (f) => (f.name = inp(p.name)) },
        { label: "ステータス", build: (f) => (f.status = MK.ui.select(PROJECT_STATUSES.map((s) => ({ value: s.key, label: s.label })), p.status)) },
        { label: "表示色", build: (f) => (f.color = inp(p.color, "color")) },
        { label: "備考", build: (f) => (f.note = inp(p.note)) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("プロジェクト名を入力してください", "error"); return; }
        MK.projects.update(p.id, { name: f.name.value.trim(), status: f.status.value, color: f.color.value, note: f.note.value });
        c();
      },
    });
  }

  // ---- プロダクト管理（Product マスタ・§6.4）----
  // ステータス絞り込みの選択状態。マスタビュー再描画（masters:changed）をまたいで保持する。
  let productFilter = "all";
  function renderProductsView() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "📦 プロダクト（マスタ）" }));
    const body = el("div", {});
    main.appendChild(body);
    renderProducts(body);
  }
  function renderProducts(container) {
    renderMaster(container, {
      api: MK.products,
      addPlaceholder: "プロダクト名を入力して追加",
      addMaxWidth: "300px",
      csvBase: "products",
      exportToast: "プロダクトCSVを書き出しました",
      importToast: (n) => n + " 件のプロダクトを取り込みました",
      onImport: () => { productFilter = "all"; },
      emptyText: "プロダクトがありません",
      // ステータス絞り込み後の一覧（productFilter はビュー再描画をまたいで保持。§6.4）。
      list: () => {
        let list = MK.products.all();
        if (productFilter !== "all") list = list.filter((p) => p.status === productFilter);
        return list;
      },
      confirmText: (p) => p.name + " を削除しますか？",
      openEdit: (p) => editProduct(p),
      // ステータス絞り込みタブ（件数バッジ）を一覧の前に差し込む。
      beforeList: (container) => {
        const c = MK.products.counts();
        const tabs = el("div", { class: "mk-toolbar" });
        tabs.appendChild(productPill("全て", "all", c.all));
        MK.products.STATUSES.forEach((s) => tabs.appendChild(productPill(s.label, s.key, c[s.key])));
        container.appendChild(tabs);
      },
      renderInfo: (p) => {
        const meta = [el("span", { class: "chip", text: productStatusLabel(p.status) })];
        const owner = MK.products.ownerPerson(p);
        if (owner) meta.push(el("span", { class: "chip" }, [
          el("span", { style: "display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:var(--space-xxs);background:" + (owner.color || "var(--color-steel)") + ";" }),
          "責任者: " + owner.name,
        ]));
        if (p.repo) meta.push(el("span", { class: "sub", text: p.repo }));
        (p.tags || []).forEach((t) => meta.push(el("span", { class: "chip", text: "#" + t })));
        MK.products.relatedProjects(p).forEach((proj) => meta.push(el("span", { class: "chip", text: "📁 " + proj.name })));
        if (p.summary) meta.push(el("span", { class: "sub", text: p.summary }));
        return el("div", { class: "grow" }, [el("div", { text: p.name }), el("div", { class: "sub" }, meta)]);
      },
    });
  }
  function productPill(label, key, count) {
    const b = el("button", { class: "pill-tab" + (productFilter === key ? " active" : "") }, [
      label + " ", el("span", { class: "badge badge-count", text: String(count || 0) }),
    ]);
    b.addEventListener("click", () => { productFilter = key; main.innerHTML = ""; renderProductsView(); });
    return b;
  }
  function productStatusLabel(key) {
    const s = MK.products.STATUSES.find((x) => x.key === key);
    return s ? s.label : key;
  }
  // プロジェクトのチェックボックス一覧を作る（Product⇄Project の緩い紐付け・Issue #55）。
  function projectCheckboxList(selectedIds) {
    const list = MK.projects.all();
    if (!list.length) return el("div", { class: "sub", text: "プロジェクトがありません" });
    const wrap = el("div", { class: "mk-stack", style: "max-height:160px;overflow:auto;" });
    const boxes = list.map((proj) => {
      const cb = MK.ui.checkbox((selectedIds || []).indexOf(proj.id) >= 0);
      cb.dataset.projectId = proj.id;
      wrap.appendChild(el("label", { style: "display:flex;gap:var(--space-xs);align-items:center;cursor:pointer;" }, [cb, el("span", { text: proj.name })]));
      return cb;
    });
    wrap.getSelected = () => boxes.filter((b) => b.checked).map((b) => b.dataset.projectId);
    return wrap;
  }
  function editProduct(p) {
    const ownerOptions = [{ value: "", label: "未設定" }].concat(MK.people.all().map((m) => ({ value: m.id, label: m.name })));
    masterEditModal({
      title: "プロダクトを編集",
      fields: [
        { label: "プロダクト名", build: (f) => (f.name = inp(p.name)) },
        { label: "ステータス", build: (f) => (f.status = MK.ui.select(MK.products.STATUSES.map((s) => ({ value: s.key, label: s.label })), p.status)) },
        { label: "責任者", build: (f) => (f.owner = MK.ui.select(ownerOptions, p.ownerId || "")) },
        { label: "概要（提供価値）", build: (f) => (f.summary = inp(p.summary)) },
        { label: "リポジトリ / リンク", build: (f) => (f.repo = inp(p.repo)) },
        { label: "タグ（カンマ区切り）", build: (f) => (f.tags = inp((p.tags || []).join(", "))) },
        { label: "関連プロジェクト", build: (f) => (f.projects = projectCheckboxList(p.projectIds)) },
      ],
      // 削除アクションは保存/キャンセルの前に置く（従来の並び）。
      extraActions: () => [
        { label: "削除", variant: "btn-danger", onClick: (close) => MK.ui.confirm("このプロダクトを削除しますか？").then((ok) => { if (ok) { MK.products.remove(p.id); close(); } }) },
      ],
      onSave: (f, c) => {
        if (!f.name.value.trim()) { MK.ui.toast("プロダクト名を入力してください", "error"); return; }
        MK.products.update(p.id, {
          name: f.name.value.trim(), status: f.status.value, ownerId: f.owner.value || null,
          summary: f.summary.value, repo: f.repo.value.trim(),
          tags: f.tags.value.split(",").map((s) => s.trim()).filter(Boolean),
          projectIds: f.projects.getSelected ? f.projects.getSelected() : [],
        });
        c();
      },
    });
  }
  // CSV ファイル選択の共通ヘルパは MK.io.pickCsvFile（shared/io.js §4.6.2）へ集約した。

  // ---- フォーム小物 ----
  function fld(label, control) { return el("div", { class: "field" }, [el("label", { text: label }), control]); }
  function inp(value, type) { return el("input", { class: "text-input", type: type || "text", value: value || "" }); }

  S.renderPeopleView = renderPeopleView;
  S.renderProjectsView = renderProjectsView;
  S.renderProductsView = renderProductsView;
})();
