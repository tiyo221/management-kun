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

  // 任意契約リーダ（spec §9.5）。モジュールの summary() を「あれば読む／無ければ null」で
  // 安全に読む単一プリミティブ。未搭載（MK_CONFIG から外した）・summary 未実装・summary が例外の
  // いずれでも null を返し、横断表示（HOME サマリー・集約ビュー #83）を壊さない。DOM 非依存。
  // 横断表示・集約ビューは他モジュールをハード参照せず必ずこれ経由で問い合わせること。
  MK.readSummary = function (id, arg) {
    const mod = MK.modules[id];
    if (!mod || typeof mod.summary !== "function") return null;
    try { return mod.summary(arg); }
    catch (e) { console.warn("summary() failed:", id, e); return null; } // 追跡用に記録（呼び手は壊さない）
  };

  // 任意契約リーダ（spec §3.6 / §9.5）。モジュールの summaryFor(entityType, id) を「あれば読む／
  // 無ければ null」で安全に読む。readSummary の「モジュール全体」に対し、こちらは「人1人・PJ1つ」など
  // エンティティ単位のサマリー（人・プロジェクト詳細の集約ビュー #83 の消費対象）。戻り値は summary()
  // 契約と同型（{ empty, stats, attention? }）。未搭載・未実装・例外のいずれでも null を返し、横断表示を
  // 壊さない。entityType はマスタ種別（"person" | "project" 等）に汎用で、"project" 決め打ち分岐をしない
  // （§3.7.6）。DOM 非依存。横断表示・集約ビューは他モジュールをハード参照せず必ずこれ経由で問い合わせること。
  MK.readEntitySummary = function (moduleId, entityType, entityId) {
    const mod = MK.modules[moduleId];
    if (!mod || typeof mod.summaryFor !== "function") return null;
    try { return mod.summaryFor(entityType, entityId); }
    catch (e) { console.warn("summaryFor() failed:", moduleId, entityType, entityId, e); return null; } // 追跡用に記録（呼び手は壊さない）
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

  // id 一致でアップサートする（Issue #186）。current を土台に incoming を id 単位で
  // 上書き・追加した配列を返す純関数。各モジュールの importData merge 分岐が再実装して
  // いた「byId マップ→Object.keys で配列化」を1か所へ集約する。結果順序は従来どおり
  // Object.keys のキー列挙順（数値 id は昇順・文字列 id は挿入順）に一致する。
  util.mergeById = function (current, incoming) {
    const byId = {};
    (current || []).forEach((x) => (byId[x.id] = x));
    (incoming || []).forEach((x) => (byId[x.id] = x));
    return Object.keys(byId).map((k) => byId[k]);
  };

  // 名寄せ照合キー（spec §8.2）: NFKC → trim → 連続空白圧縮 → 小文字化
  util.normalizeKey = function (name) {
    return String(name == null ? "" : name)
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  };

  /**
   * ステータス定義（`[{ key, label }]`）から定型メソッドを束ねた小ヘルパを作る（Issue #188）。
   * 複数モジュール／マスタで反復していた「ラベル解決 / 正規化 / 件数集計」の共通部分だけを集約する。
   * counts の追加キー（questions の knowledge 等）や productId 絞り込みは呼び出し側で足す。
   * @param {{key: string, label: string}[]} statuses - 表示順を兼ねたステータス定義配列
   * @param {Object} [opts]
   * @param {string} [opts.fallback] - normalize が未知値を寄せる既定キー（省略時は先頭キー）
   * @param {Object.<string, string>} [opts.byLabel] - 「日本語ラベル→key」変換テーブル（モジュール固有語彙）
   * @returns {{ label: function(string): string, normalize: function(*): string, counts: function(Array, function): Object }}
   */
  util.statusSet = function (statuses, opts) {
    const o = opts || {};
    const keys = statuses.map((s) => s.key);
    const fallback = o.fallback != null ? o.fallback : (keys[0] || "");
    const byLabel = o.byLabel || null;
    return {
      // key を表示ラベルへ。未知・空はキーをそのまま返す（従来の定型と同一）。
      label: function (key) {
        const s = statuses.find((x) => x.key === key);
        return s ? s.label : key;
      },
      // key または（byLabel があれば）日本語ラベルを寛容に解釈し、未知・未指定は fallback へ寄せる。
      normalize: function (v) {
        const raw = String(v == null ? "" : v).trim();
        if (byLabel && byLabel[raw]) return byLabel[raw];
        const k = raw.toLowerCase();
        return keys.indexOf(k) >= 0 ? k : fallback;
      },
      // `all` ＋ 各 key を 0 初期化して集計。getKey は要素からステータスキーを取り出す関数。
      counts: function (items, getKey) {
        const c = { all: 0 };
        statuses.forEach((s) => (c[s.key] = 0));
        (items || []).forEach((it) => {
          c.all++;
          const k = getKey(it);
          c[k] = (c[k] || 0) + 1;
        });
        return c;
      },
    };
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
