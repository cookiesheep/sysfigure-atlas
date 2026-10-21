/* 参考包导出 guard（round3b）：浏览器与 Node 共用（正式参考包有效性判定）。
   与 scripts/pack_guard.py 的正式包口径一致：
   有效精选 + 裁图审核 ok + 来源已验证 + 不可照搬说明 + 可核实来源链接。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.RefpackGuard = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function formalBlockReasons(f) {
    // round3d：优先消费索引物化的共享核心判定（formal_usable/rejection_reasons，
    // 与 build_index/pack_guard/CLI 同源）；旧索引无该字段时回退到本地字段检查。
    if (typeof f.formal_usable === "boolean") {
      const rs = [];
      if (!f.formal_usable) {
        rs.push("不可正式使用（" + ((f.rejection_reasons && f.rejection_reasons.join("; ")) || "未给出原因") + "）");
      }
      if (f.independent_acceptance === null || f.independent_acceptance === undefined) {
        // 如实：仅模型策展，无独立视觉验收（不阻塞 formal，但导出物如实携带该身份）
      }
      return rs;
    }
    const rs = [];
    if (!f.is_curated) rs.push("非有效精选（" + (f.curation_validity || "无策展") + "）");
    if (f.crop_status !== "ok") rs.push("裁图审核状态 " + f.crop_status);
    if (!f.source_verified) rs.push("来源审核无效/未验证");
    const ntc = Array.isArray(f.not_to_copy) ? f.not_to_copy.join("") : (f.not_to_copy || "");
    if (!ntc.trim()) rs.push("缺不可照搬说明（not_to_copy）");
    if (!f.landing_url && !f.pdf_url && !f.doi) rs.push("缺可核实来源（landing_url/pdf_url/DOI）");
    return rs;
  }

  /* items: [{id, borrow, avoid}]（页面编辑值）；byId: id -> figure 的查找函数或 {id: figure} 映射 */
  function buildManifest(items, byId, projectRoot) {
    const lookup = (typeof byId === "function") ? byId : (id => byId[id]);
    const formal = [], blocked = [];
    for (const it of items) {
      const f = lookup(it.id);
      if (!f) { blocked.push({ figure_id: it.id, reasons: ["不在索引中"] }); continue; }
      const reasons = formalBlockReasons(f);
      // 3C：用户清空编辑框后不得进正式包（编辑值检查，非仅索引字段）
      if (!String(it.borrow || "").trim()) reasons.push("借鉴点（borrow）被清空");
      if (!String(it.avoid || "").trim()) reasons.push("不可照搬（do_not_copy）被清空");
      const entry = {
        figure_id: f.id, paper_title: f.title, venue: f.venue, year: f.year,
        track: f.track, container_title: f.container_title,
        doi: f.doi, landing_url: f.landing_url, pdf_url: f.pdf_url,
        pdf_version: f.pdf_version, pdf_source: f.pdf_source,
        figure_number: f.figure_number, pdf_page_1_based: (f.pdf_page_index_0_based ?? 0) + 1,
        caption_original: f.caption,
        local_image_relpath: f.image, image_sha256: f.image_hash,
        crop_status: f.crop_status, curation_validity: f.curation_validity,
        source_verified: f.source_verified,
        formal_usable: (typeof f.formal_usable === "boolean") ? f.formal_usable : undefined,
        independent_acceptance: (f.independent_acceptance === undefined) ? null : f.independent_acceptance,
        borrow: it.borrow, do_not_copy: it.avoid,
      };
      if (reasons.length) blocked.push({ entry, reasons });
      else formal.push(entry);
    }
    return {
      generated_at: new Date().toISOString(),
      tool: "SysFigure Atlas reference pack (web export, guarded)",
      guard: "正式条目须同时满足：有效精选+裁图审核ok+来源已验证+不可照搬说明+可核实来源链接。"
           + "被拦截条目仅作候选浏览参考，不得当正式参考包使用。",
      usage: "供网页版生图/人工参考；图片归原作者与出版方，本地研究使用，不得公开再分发。",
      project_root: projectRoot || null,
      figures: formal,
      blocked,
    };
  }

  return { formalBlockReasons: formalBlockReasons, buildManifest: buildManifest };
});
