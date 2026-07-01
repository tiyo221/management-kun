/* マネジメントくん — 共通コア（window.MK 名前空間） spec §3.5 */
(function () {
  "use strict";

  const MK = {
    modules: {},        // id -> def
    moduleOrder: [],    // 表示順
    migrations: {},     // ns -> [{ to, up(data) }]
    _bus: {},           // event -> [handler]
  };

  // モジュール登録（spec §3.5）
  MK.registerModule = function (id, def) {
    if (MK.modules[id]) console.warn("module already registered:", id);
    MK.modules[id] = Object.assign({ id }, def);
    if (!MK.moduleOrder.includes(id)) MK.moduleOrder.push(id);
  };

  // 軽量イベントバス（マスタ変更通知など）
  MK.bus = {
    on(event, handler) {
      (MK._bus[event] = MK._bus[event] || []).push(handler);
    },
    emit(event, payload) {
      (MK._bus[event] || []).forEach((h) => {
        try { h(payload); } catch (e) { console.error(e); }
      });
    },
  };

  // ---- ユーティリティ ----
  const util = {};

  // ID 採番（spec §4.7）。再利用しない。
  util.uid = function (prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  };

  util.nowISO = function () { return new Date().toISOString(); };

  util.todayISO = function () { return util.fmtDate(new Date()); };
  util.fmtDate = function (d) { const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  util.addDays = function (iso, n) { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return util.fmtDate(d); };
  util.daysBetween = function (a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000); };
  util.mondayOf = function (iso) { const d = new Date(iso + "T00:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return util.fmtDate(d); };

  // 名寄せ照合キー（spec §8.2）: NFKC → trim → 連続空白圧縮 → 小文字化
  util.normalizeKey = function (name) {
    return String(name == null ? "" : name)
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  };

  // HTML エスケープ（XSS 防止・spec §10.1）
  util.escapeHtml = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // 要素生成ヘルパ。text は textContent、html は呼び出し側でエスケープ済み前提。
  util.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  };

  MK.util = util;
  window.MK = MK;
})();
