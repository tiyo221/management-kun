/* シェル：HOME（玄関ダッシュボード。spec §3.6 / Issue #100）。shell-core・shell-nav の後に読む（Issue #140）。
   HOME は HOME 固有の価値だけに絞る: 要対応バー（attention）＋ピン留めモジュールのフルカードのみ。
   モジュール一覧の常設表示は常設ランチャーであるサイドバー（shell-nav）に一本化した（Issue #169）。
   配布サブセット（MK_CONFIG.zones を絞ったエントリ・spec §1.5）でも同じ2層構成で動く。
   core が S へ載せた定数・ヘルパを分割代入で受け取る（core は先に読まれるので参照可）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = MK.util.el;
  const S = window.MK.shell;
  const { META, ZONES, ZONE_MODULES, main } = S;
  const { route, isHiddenModule, isPinnedModule, getPinnedModules, setModulePinned } = S;

  function renderHome() {
    main.appendChild(el("h2", { class: "mk-section-title", text: "🏠 HOME" }));
    renderHomeAttention();
    renderHomePinned();
  }

  // 「要対応」帯（Issue #102）。表示中モジュールの summary().attention を集約し、severity 別の
  // バッジで表示する。attention は任意契約のため、未実装・不正形式のモジュールは単に出ない。
  // 要対応が1件も無ければ帯そのものを描画しない。
  const ATTENTION_RANK = { error: 0, warn: 1, info: 2 };
  function renderHomeAttention() {
    const items = [];
    ZONES.forEach((zone) => (zone.modules || []).forEach((id) => {
      if (!META[id] || isHiddenModule(id)) return;
      const sum = moduleSummary(id);
      if (!sum || !Array.isArray(sum.attention)) return;
      sum.attention.forEach((a) => {
        if (!a || typeof a.label !== "string") return;
        items.push({ id, label: a.label, severity: ATTENTION_RANK[a.severity] !== undefined ? a.severity : "info" });
      });
    }));
    if (!items.length) return;
    // 重要度順（error → warn → info）。同重要度はゾーン順を保つ（sort は安定）。
    items.sort((a, b) => ATTENTION_RANK[a.severity] - ATTENTION_RANK[b.severity]);
    const bar = el("div", { class: "mk-home-attention" });
    items.forEach((a) => {
      const b = el("button", {
        class: "mk-home-attn " + a.severity,
        "aria-label": META[a.id].title + ": " + a.label,
      }, [
        el("span", { class: "mk-home-attn-icon", text: META[a.id].icon || "" }),
        el("span", { text: a.label }),
      ]);
      b.addEventListener("click", () => route(a.id));
      bar.appendChild(b);
    });
    main.appendChild(bar);
  }

  // ピン留めセクション。ピンが無ければ使い方の案内だけ出す。
  function renderHomePinned() {
    const pinned = getPinnedModules().filter((id) => META[id] && ZONE_MODULES[id] && !isHiddenModule(id));
    if (!pinned.length) {
      main.appendChild(el("p", { class: "mk-home-pin-hint sub", text: "サイドバーの各モジュールの右端にある ☆ を押すと、ここにサマリー付きでピン留め表示されます。" }));
      return;
    }
    main.appendChild(el("h3", { class: "mk-home-zone", text: "📌 ピン留め" }));
    const grid = el("div", { class: "mk-home-grid" });
    pinned.forEach((id) => grid.appendChild(homeCard(id)));
    main.appendChild(grid);
  }

  // モジュールの1行説明（＝「何ができるか」。Issue #40）。定義側 def.description を単一ソース
  // にし、META へハードコードして二重管理しない。準備中（未実装＝def なし）は説明を持たない。
  function moduleDescription(id) {
    const mod = MK.modules[id];
    return mod && typeof mod.description === "string" ? mod.description : "";
  }

  // summary は任意契約。未実装・例外でも HOME 全体を壊さない（null を返して呼び手がフォールバック）。
  // 実体は DOM 非依存の共通プリミティブ MK.readSummary（core.js・spec §9.5）に委譲し単一ソース化する。
  function moduleSummary(id) { return MK.readSummary(id); }

  // ピン留めトグル（★/☆）。カード／チップのクリック遷移と衝突しないよう伝播を止める。
  // 再描画後もフォーカスを同じトグルへ戻し、キーボード操作を連続できるようにする。
  function pinButton(id) {
    const pinned = isPinnedModule(id);
    const b = el("button", {
      class: "mk-home-pin" + (pinned ? " pinned" : ""),
      "aria-label": (pinned ? "ピン留めを解除: " : "ピン留め: ") + META[id].title,
      "aria-pressed": String(pinned),
      title: pinned ? "ピン留めを解除" : "ピン留め",
      "data-pin": id,
      text: pinned ? "★" : "☆",
    });
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      setModulePinned(id, !pinned);
      route("home");
      const again = main.querySelector('[data-pin="' + CSS.escape(id) + '"]');
      if (again) again.focus();
    });
    return b;
  }

  function homeCard(id) {
    const meta = META[id];
    const card = el("div", { class: "card mk-home-card", role: "button", tabindex: "0" });
    card.appendChild(el("div", { class: "mk-home-card-head" }, [
      el("span", { class: "mk-home-icon", text: meta.icon || "" }),
      el("span", { class: "mk-home-title", text: meta.title }),
      pinButton(id),
    ]));
    // 1行説明（何ができるか。Issue #40）。stats の上に置き、初見でも用途が分かるようにする。
    const desc = moduleDescription(id);
    if (desc) card.appendChild(el("div", { class: "mk-home-desc", text: desc }));
    if (!MK.modules[id]) {
      card.appendChild(el("div", { class: "sub", text: "準備中" }));
    } else {
      const sum = moduleSummary(id);
      if (!sum || !Array.isArray(sum.stats)) {
        card.appendChild(el("div", { class: "sub", text: "開く" }));
      } else if (sum.empty) {
        card.appendChild(el("div", { class: "mk-home-empty sub", text: "データがありません" }));
      } else {
        const row = el("div", { class: "mk-home-stats" });
        sum.stats.forEach((s) => row.appendChild(el("div", { class: "mk-stat" }, [
          el("div", { class: "num", text: String(s.value) }),
          el("div", { class: "lbl", text: s.label }),
        ])));
        card.appendChild(row);
      }
    }
    const go = () => route(id);
    card.addEventListener("click", go);
    // ピン留めトグル（内包 button）からのバブリングでは遷移しない（e.target を自分に限定）
    card.addEventListener("keydown", (e) => { if (e.target !== card) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    return card;
  }

  S.renderHome = renderHome;
  S.moduleDescription = moduleDescription;
})();
