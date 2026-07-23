/* 共通UI部品（モーダル・トースト・確認）spec §6.3 */
(function () {
  "use strict";
  const MK = window.MK;
  const el = (t, a, c) => MK.util.el(t, a, c);
  const ui = {};

  function toastHost() {
    let host = document.getElementById("mk-toasts");
    if (!host) {
      host = el("div", { id: "mk-toasts", class: "mk-toasts" });
      document.body.appendChild(host);
    }
    return host;
  }

  function showToast(node, ms) {
    toastHost().appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 300);
    }, ms);
  }

  ui.toast = function (message, type) {
    showToast(el("div", { class: "mk-toast " + (type || "info"), text: message }), 3000);
  };

  // 取り消しトースト（破壊的操作は confirm ではなくこれを既定にする。CONVENTIONS §2.5-3）
  // message: 実行済みの操作を伝える文（例「削除しました」）／onUndo: 「元に戻す」押下時に呼ぶ復元処理
  ui.undoToast = function (message, onUndo) {
    const btn = el("button", { class: "btn btn-ghost", text: "元に戻す" });
    const t = el("div", { class: "mk-toast info" }, [String(message == null ? "" : message) + "　", btn]);
    btn.addEventListener("click", () => {
      t.remove();
      if (typeof onUndo === "function") onUndo();
    });
    showToast(t, 6000);
  };

  // opts: { title, body(string|Node), actions:[{label, variant, onClick(close)}] }
  ui.modal = function (opts) {
    opts = opts || {};
    const overlay = el("div", { class: "mk-modal-overlay" });
    const box = el("div", { class: "mk-modal" });
    const head = el("div", { class: "mk-modal-head" }, [el("h3", { text: opts.title || "" })]);
    const body = el("div", { class: "mk-modal-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body; // 呼び出し側でエスケープ済み前提
    else if (opts.body) body.appendChild(opts.body);
    const foot = el("div", { class: "mk-modal-foot" });

    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }

    (opts.actions || []).forEach((a) => {
      foot.appendChild(el("button", {
        class: "btn " + (a.variant || "btn-secondary"),
        text: a.label,
        onClick: () => a.onClick && a.onClick(close),
      }));
    });

    box.appendChild(head);
    box.appendChild(body);
    if (foot.childNodes.length) box.appendChild(foot);
    overlay.appendChild(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    return { close, body };
  };

  ui.confirm = function (message) {
    return new Promise((resolve) => {
      ui.modal({
        title: "確認",
        body: el("p", { text: message }),
        actions: [
          { label: "キャンセル", variant: "btn-secondary", onClick: (close) => { close(); resolve(false); } },
          { label: "OK", variant: "btn-primary", onClick: (close) => { close(); resolve(true); } },
        ],
      });
    });
  };

  // ---- レイアウト・部品ヘルパ（view はこれを使い、部品を自作しない。CONVENTIONS §3）----
  ui.sectionTitle = function (text) { return el("h2", { class: "mk-section-title", text: text }); };
  ui.stack = function (children) { return el("div", { class: "mk-stack" }, children || []); };
  ui.toolbar = function (children) { return el("div", { class: "mk-toolbar" }, children || []); };
  ui.card = function (children, opts) {
    opts = opts || {};
    const attrs = { class: "card" };
    if (opts.flush) attrs.style = "padding:0;overflow:hidden;";
    return el("div", attrs, children || []);
  };
  // 空状態ガイド（Issue #41）。文字列は従来どおり1行表示。
  // オブジェクト { title, hint, action:{label, onClick, variant} } で「次の一手」を案内する。
  // 文言は呼び出し側（各モジュール）が持つ。器のレイアウト/トーンだけここで共通化する。
  ui.emptyState = function (arg) {
    if (arg == null || typeof arg === "string") return el("div", { class: "mk-empty", text: arg || "" });
    const box = el("div", { class: "mk-empty" });
    if (arg.title) box.appendChild(el("div", { class: "mk-empty-title", text: arg.title }));
    if (arg.hint) box.appendChild(el("div", { class: "mk-empty-hint", text: arg.hint }));
    if (arg.action) box.appendChild(ui.button(arg.action.label, { variant: arg.action.variant || "btn-primary", onClick: arg.action.onClick }));
    return box;
  };
  ui.statsRow = function (items) {
    return el("div", { class: "card" }, (items || []).map((it) =>
      el("div", { class: "mk-stat" }, [el("div", { class: "num", text: String(it.num) }), el("div", { class: "lbl", text: it.label })])));
  };
  ui.button = function (label, opts) {
    opts = opts || {};
    const b = el("button", { class: "btn " + (opts.variant || "btn-secondary"), text: label, title: opts.title });
    if (opts.onClick) b.addEventListener("click", opts.onClick);
    return b;
  };
  ui.field = function (label, control) { return el("div", { class: "field" }, [el("label", { text: label }), control]); };
  ui.input = function (opts) {
    opts = opts || {};
    const i = el("input", { class: "text-input", type: opts.type || "text", placeholder: opts.placeholder });
    i.value = opts.value == null ? "" : opts.value;
    if (opts.onChange) i.addEventListener("change", () => opts.onChange(i.value));
    if (opts.onEnter) i.addEventListener("keydown", (e) => { if (e.key === "Enter") opts.onEnter(i.value); });
    return i;
  };
  ui.textarea = function (value) { const t = el("textarea", { class: "text-input" }); t.value = value || ""; return t; };
  ui.checkbox = function (checked) { const c = el("input", { type: "checkbox" }); c.checked = !!checked; return c; };
  ui.select = function (options, value, onChange) {
    const s = el("select", { class: "text-input" });
    (options || []).forEach((o) => s.appendChild(el("option", { value: o.value, text: o.label })));
    if (value != null) s.value = value;
    if (onChange) s.addEventListener("change", () => onChange(s.value));
    return s;
  };
  ui.pillTabs = function (tabs, activeKey, onChange) {
    const bar = el("div", { class: "mk-toolbar" });
    (tabs || []).forEach((t) => {
      const b = el("button", { class: "pill-tab" + (t.key === activeKey ? " active" : ""), text: t.label });
      b.addEventListener("click", () => onChange(t.key));
      bar.appendChild(b);
    });
    return bar;
  };

  MK.ui = ui;
})();
