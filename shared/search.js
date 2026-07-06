/* グローバル検索（コマンドパレット）のマッチング純関数（Issue #82）。
   DOM 非依存・テスト可能。シェル（shared/shell.js）がソース項目をこの MK.search で
   絞り込み・並べ替えして描画する。各モジュールは任意契約 def.searchItems() で
   検索対象レコードを供給できる（未実装モジュールは単に候補が増えないだけ・spec §3.5）。 */
(function () {
  "use strict";
  const MK = window.MK;
  const norm = (s) => MK.util.normalizeKey(s);

  // 検索項目 1件の探索対象文字列（label＝主・sub/keywords＝補助）を正規化して束ねる。
  function haystack(item) {
    return norm([item.label, item.sub, (item.keywords || []).join(" ")].join(" "));
  }

  // 1トークンの一致スコア。label 一致を優先（完全 > 前方 > 部分）、補助テキストのみの
  // 一致は低め。どこにも無ければ -1（＝この項目はこのトークンに不一致）。
  function tokenScore(token, label, hay) {
    if (label === token) return 100;
    if (label.indexOf(token) === 0) return 60;
    if (label.indexOf(token) >= 0) return 40;
    if (hay.indexOf(token) >= 0) return 15;
    return -1;
  }

  // クエリと項目の総合スコア。空クエリは 0（中立）。複数トークンは AND（全トークンが
  // どこかに含まれること）。1つでも欠ければ -1（不一致）。同スコアなら短い label を優先。
  function score(query, item) {
    const q = norm(query);
    if (!q) return 0;
    const label = norm(item.label);
    const hay = haystack(item);
    const tokens = q.split(" ").filter(Boolean);
    let total = 0;
    for (let i = 0; i < tokens.length; i++) {
      const s = tokenScore(tokens[i], label, hay);
      if (s < 0) return -1;
      total += s;
    }
    return total - label.length * 0.01;
  }

  // 絞り込み＋並べ替え。空クエリはソース順のまま先頭 limit 件（画面ジャンプの既定候補）。
  // 一致（score >= 0）のみをスコア降順で返し、同点は元の順序で安定させる。
  function rank(query, items, limit) {
    const max = limit || 20;
    if (!norm(query)) return items.slice(0, max);
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      const s = score(query, items[i]);
      if (s >= 0) scored.push({ item: items[i], s, i });
    }
    scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
    return scored.slice(0, max).map((x) => x.item);
  }

  MK.search = { score, rank };
})();
