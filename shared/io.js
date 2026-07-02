/* JSON エンベロープ入出力・CSV spec §4.2 / §4.3 / §4.6 */
(function () {
  "use strict";
  const MK = window.MK;
  const io = {};

  // scope: "all" | "people" | "projects" | "<moduleId>"
  io.buildEnvelope = function (scope) {
    scope = scope || "all";
    const env = {
      schema: "management-kun",
      schemaVersion: MK.store.SCHEMA_VERSION,
      exportedAt: MK.util.nowISO(),
      scope,
      people: MK.people.all(),
      projects: MK.projects.all(),
      modules: {},
    };
    MK.moduleOrder.forEach((id) => {
      const mod = MK.modules[id];
      if (!mod || typeof mod.exportData !== "function") return;
      if (scope !== "all" && scope !== id) return;
      const dim = MK.scope.dimOf(mod.scope);
      if (dim) {
        // scoped モジュール（§3.7.4）: 対象（PJ）ごとにデータを束ねて出す。
        // 復元時に対象別キーへ戻せるよう、targets を targetId で引ける形にする。
        const targets = {};
        MK.scope.entities(dim).forEach((e) => { targets[e.id] = mod.exportData(e.id); });
        env.modules[id] = { version: 1, scope: { dim: dim.dim }, targets };
      } else {
        env.modules[id] = { version: 1, data: mod.exportData() };
      }
    });
    if (scope === "people") { env.projects = []; env.modules = {}; }
    if (scope === "projects") { env.people = []; env.modules = {}; }
    return env;
  };

  io.downloadText = function (filename, text, mime) {
    const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = MK.util.el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  io.download = function (filename, obj) {
    io.downloadText(filename, JSON.stringify(obj, null, 2), "application/json");
  };

  io.importEnvelope = function (env, mode) {
    if (!env || env.schema !== "management-kun") {
      throw new Error("対応していない形式です（schema 不一致）");
    }
    if (env.schemaVersion > MK.store.SCHEMA_VERSION) {
      throw new Error("新しいバージョンのデータです。アプリを更新してください。");
    }
    mode = mode === "merge" ? "merge" : "replace";

    if (Array.isArray(env.people) && env.people.length) {
      if (mode === "replace") MK.people.replaceAll(env.people);
      else env.people.forEach((m) => (MK.people.get(m.id) ? MK.people.update(m.id, m) : MK.people.create(m)));
    }
    if (Array.isArray(env.projects) && env.projects.length) {
      if (mode === "replace") MK.projects.replaceAll(env.projects);
      else env.projects.forEach((p) => (MK.projects.get(p.id) ? MK.projects.update(p.id, p) : MK.projects.create(p)));
    }
    Object.keys(env.modules || {}).forEach((id) => {
      const mod = MK.modules[id];
      if (!mod || typeof mod.importData !== "function") return;
      const entry = env.modules[id] || {};
      const dim = MK.scope.dimOf(mod.scope);
      if (entry.targets && typeof entry.targets === "object") {
        // 対象別 scope のエンベロープ（§3.7.4）: PJ ごとに対象別キーへ戻す。
        // people/projects は先に取り込み済みなので targetId（PJ id）が一致する。
        Object.keys(entry.targets).forEach((tid) => mod.importData(entry.targets[tid], mode, tid));
      } else if (dim) {
        // 旧エンベロープ（scoped 化前の単一 data）を scoped モジュールへ取り込む場合は
        // 既定の対象（先頭 PJ・無ければ作成）へ寄せる（データを失わない・§7 / Issue #25）。
        const tid = MK.scope.ensureDefaultTarget(dim);
        if (tid) mod.importData(entry.data, mode, tid);
      } else {
        mod.importData(entry.data, mode);
      }
    });
  };

  // ---- CSV（RFC4180 準拠の簡易実装・BOM 対応）spec §4.6 ----
  io.csv = {
    parse(text) {
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 先頭 BOM 除去
      const rows = [];
      let row = [], field = "", i = 0, inQuotes = false;
      while (i < text.length) {
        const c = text[i];
        if (inQuotes) {
          if (c === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQuotes = false; i++; continue;
          }
          field += c; i++; continue;
        }
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ",") { row.push(field); field = ""; i++; continue; }
        if (c === "\r") { i++; continue; }
        if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
        field += c; i++;
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      return rows;
    },
    stringify(rows) {
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n"); // 出力は BOM 付き
    },
  };

  MK.io = io;
})();
