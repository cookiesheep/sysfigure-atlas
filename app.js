/* SysFigure Atlas 前端 v2 —— 无框架静态画廊（G4：会议/图类/机制整合 + 解释面板）。
 * 数据：data/index.json（生产只读索引）+ data/gallery_content.json（浏览层内容：G2/G4 视觉批次，可缺）。
 * 个人偏好存 localStorage（契约不变）：sfa_reviews_v1 {id:{starred,rating,collections,notes,updated_at}}
 *   + sfa_ui_v1 {density,admin,view}。不 清空/迁移 旧笔记。
 * 搜索复用 G3 语义：机制词归一（词边界，CP≠CPU/checkpoint）+ 剩余限定词映射用途/结构或作自由词，不静默丢词。
 */
"use strict";

const LS_KEY = "sfa_reviews_v1";
const LS_UI = "sfa_ui_v1";
const PAGE_SIZE = 120; // 增量渲染：首屏与每页数量

const state = {
  figures: [],
  papers: {},
  projectRoot: "",
  assetBase: "/",
  publicSite: false,
  reviews: loadReviews(),
  ui: loadUI(),
  order: [],            // 当前筛选后的 id 列表
  rendered: 0,          // 已渲染数量（增量）
  lbIndex: -1,
  compare: [],          // ids, ≤4
  similarReturn: null,   // 同类浏览中返回原图的 id
  lbStack: [],           // 同类跳转返回栈：每次跳转保存 {list(数组|null=网格), index}
  lbList: null,           // 灯箱导航上下文（同类浏览时为同类列表，否则 null=当前网格序）
  refpack: [],          // ids, ≤6
  zoom: 1,
  content: null,        // gallery_content.json
  vocab: null,          // 机制/用途/结构/图类词表
  showFixture: false,
  qMech: [], qPurpose: [], qStructure: [], qFree: [],   // 查询派生（可✕清除）
  mech: new Set(), purpose: new Set(), structure: new Set(), topic: new Set(), // chip 选择
};

/* ---------------- 存储（契约不变） ---------------- */
function loadReviews() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
  catch { return {}; }
}
function saveReviews() { localStorage.setItem(LS_KEY, JSON.stringify(state.reviews)); }
function loadUI() {
  try { return JSON.parse(localStorage.getItem(LS_UI) || "{}"); }
  catch { return {}; }
}
function saveUI() {
  localStorage.setItem(LS_UI, JSON.stringify({
    density: state.ui.density, admin: state.ui.admin, view: state.ui.view, figType: state.ui.figType,
  }));
}
function reviewOf(id) { return state.reviews[id] || { starred: false, rating: null, collections: [], notes: "" }; }
function setReview(id, patch) {
  const r = { ...reviewOf(id), ...patch, updated_at: new Date().toISOString() };
  state.reviews[id] = r; saveReviews();
}

/* ---------------- 工具 ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const imgUrl = (rel) => rel ? new URL(rel, new URL(state.assetBase, document.baseURI)).href : "";
function toast(msg, isErr) {
  const t = $("#toast"); t.textContent = msg;
  t.className = isErr ? "error" : ""; t.hidden = false;
  clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, 2400);
}
function byId(id) { return state.figures.find(f => f.id === id); }
function contentOf(id) { return (state.content && state.content.entries && state.content.entries[id]) || null; }
function g2of(f) { const c = contentOf(f.id); return (c && c.g2) || null; }

function dupHashPrefixes() {
  const count = new Map();
  for (const f of state.figures) {
    if (!f.perceptual_hash) continue;
    const p = f.perceptual_hash.slice(0, 8);
    count.set(p, (count.get(p) || 0) + 1);
  }
  return new Set([...count.entries()].filter(([, n]) => n > 1).map(([p]) => p));
}

/* ---------------- 查询归一（G3 语义：机制别名→键；剩余词→用途/结构映射+自由词） ---------------- */
function parseQuery(q) {
  const s = q.trim().toLowerCase();
  if (!s || !state.vocab) return { mech: [], purpose: [], structure: [], free: s ? s.split(/[\s,，;；]+/).filter(Boolean) : [] };
  const spans = [];
  for (const def of Object.values(state.vocab.mechanisms)) {
    for (const alias of def.aliases) {
      const a = alias.toLowerCase();
      if (/^[a-z]+$/.test(a)) {
        const re = new RegExp("\\b" + a + "\\b", "g");
        let m;
        while ((m = re.exec(s))) spans.push([m.index, m.index + a.length]);
      } else {
        let i = s.indexOf(a);
        while (i >= 0) { spans.push([i, i + a.length]); i = s.indexOf(a, i + a.length); }
      }
    }
  }
  const mech = [];
  for (const [key, def] of Object.entries(state.vocab.mechanisms)) {
    for (const alias of def.aliases) {
      const a = alias.toLowerCase();
      const hit = /^[a-z]+$/.test(a) ? new RegExp("\\b" + a + "\\b").test(s) : s.includes(a);
      if (hit) { mech.push(key); break; }
    }
  }
  const rest = s.split("").map((ch, i) => spans.some(([a, b]) => i >= a && i < b) ? " " : ch).join("");
  const tokens = rest.split(/[\s,，;；]+/).map(t => t.trim()).filter(Boolean);
  const purpose = [], structure = [], free = [];
  for (const t of tokens) {
    if (state.vocab.purposes.includes(t)) purpose.push(t);
    else if (state.vocab.structures.includes(t)) structure.push(t);
    else free.push(t);
  }
  return { mech: [...new Set(mech)], purpose, structure, free };
}

function renderInterp() {
  const bar = $("#interpBar");
  if (!bar) return;
  bar.innerHTML = "";
  const parts = [];
  for (const k of state.qMech) {
    const d = state.vocab.mechanisms[k];
    parts.push(`${d.label.split(" · ")[0]} = ${d.full}（${d.label.split(" · ")[1]}）`);
  }
  if (state.qPurpose.length) parts.push(`用途筛选：${state.qPurpose.join("·")}`);
  if (state.qStructure.length) parts.push(`结构筛选：${state.qStructure.join("·")}`);
  if (state.qFree.length) parts.push(`自由词：${state.qFree.join(" ")}（对题名/图注/借鉴点/图解做文本匹配，未命中即空）`);
  if (!parts.length) return;
  const chip = document.createElement("span");
  chip.className = "interp";
  chip.innerHTML = `已解释查询：${esc(parts.join("；"))} <button id="interpClear" title="清除语义解释，改用原始文本检索">✕清除</button>`;
  bar.appendChild(chip);
  $("#interpClear").addEventListener("click", () => {
    state.qMech = []; state.qPurpose = []; state.qStructure = []; state.qFree = [];
    render();
  });
}

/* ---------------- 视图与筛选 ---------------- */
const VIEWS = {
  usable: { title: "可用参考", desc: "经模型目检并整理图解的可浏览参考（多批次累积；非人工独立审核）" },
  mech: { title: "机制表达", desc: "图内直接描绘 CP/DP/PP 等机制的可用参考" },
  exp: { title: "实验与局部画法", desc: "实验结果或局部画法的可用参考" },
  pending: { title: "待整理", desc: "未目检/待修/不相关/生产已拒——只可浏览" },
  all: { title: "全部候选", desc: "全部公开记录（含待审，不等于已整理）" },
  starred: { title: "我的收藏", desc: "仅我的收藏" },
  curated: { title: "旧策展·历史", desc: "旧模型精选 56 张（历史筛选，非当前质量口径）" },
};

const ISOLATION = new Set(["needs_recheck", "crop_review_not_ok"]);
function liveUsable(f) {
  const c = contentOf(f.id);
  if (!c || !c.g2 || c.g2.browse_decision !== "usable") return false;
  const iv = f.independent || {};
  if (iv.record_status === "current" && (iv.conclusion === "rejected" || iv.conclusion === "needs_fix")) return false;
  if (ISOLATION.has(f.curation_validity || "none")) return false;
  if (f.visibility !== "gallery") return false;
  if (f.image_hash && c.image_sha256 && f.image_hash !== c.image_sha256) return false;
  return true;
}
function viewFilter(f) {
  const view = state.ui.view || "usable";
  const c = contentOf(f.id);
  const usable = liveUsable(f);
  const admin = state.ui.admin === "1";
  if (f.visibility !== "gallery" && !admin) return false;
  if (view === "curated") return !!f.is_curated;
  if (view === "starred") return reviewOf(f.id).starred;
  if (view === "all") return true;
  if (view === "pending") return !usable;
  if (view === "usable") return usable;
  if (view === "mech") return usable && Object.values((c && c.g2 && c.g2.mechanisms) || {}).includes("depicted");
  if (view === "exp") return usable && (c && (c.fig_type === "quantitative" || c.fig_type === "mixed"));
  return true;
}

function visibleFigures() {
  const q = $("#search").value.trim();
  const venue = $("#fVenue").value, year = $("#fYear").value, purpose = $("#fPurpose").value;
  const pattern = $("#fPattern").value, status = $("#fStatus").value;
  const track = $("#fTrack").value, tag = $("#fTag").value;
  const figType = $("#fFigType") ? $("#fFigType").value : "";
  const indep = $("#fInd") ? $("#fInd").value : "";
  const starredOnly = $("#fStarred").checked;
  const admin = state.ui.admin === "1";
  const dups = dupHashPrefixes();

  // 机制维证据规则（G3）：mech/usable/exp 视图要求 depicted（mech）/depicted|caption_supported（usable、exp）；
  // pending/all 视图允许任意 g2 证据或召回线索命中（徽标如实显示级别）。
  const mechSel = new Set([...state.qMech, ...state.mech]);
  const view = state.ui.view || "usable";
  const strictEvidences = view === "mech" ? ["depicted"]
    : (view === "usable" || view === "exp") ? ["depicted", "caption_supported"] : null;
  const topicSel = new Set([...state.topic]);
  const purpSel = new Set([...state.qPurpose, ...state.purpose]);
  const strucSel = new Set([...state.qStructure, ...state.structure]);
  const parsed = parseQuery(q);
  const freeWords = state.qMech.length || state.qPurpose.length || state.qStructure.length
    ? state.qFree : (q ? q.toLowerCase().split(/[\s,，;；]+/).filter(Boolean) : []);

  let list = state.figures.filter(f => {
    if (!viewFilter(f)) return false;
    if (f.fixture !== true && !state.showFixture && f.id.startsWith("fixture:")) return false;
    if (f.crop_status === "excluded" && !admin) return false;
    const c = contentOf(f.id);
    const g2 = c && c.g2;
    if (venue && f.venue !== venue) return false;
    if (year && String(f.year) !== year) return false;
    if (track && f.track !== track) return false;
    if (purpose && f.figure_purpose !== purpose) return false;
    if (pattern && !(f.visual_patterns || []).includes(pattern)) return false;
    if (tag && !(f.visual_tags || []).includes(tag)) return false;
    if (figType) {
      const ft = c && c.fig_type;
      if (ft !== figType) return false;
    }
    if (status === "suspect-dup") {
      if (!(f.perceptual_hash && dups.has(f.perceptual_hash.slice(0, 8)))) return false;
    } else if (status && f.crop_status !== status) return false;
    if (indep) {
      const iv = f.independent || {};
      if (indep === "accepted" && iv.independent_acceptance !== true) return false;
      if (indep === "rejected" && !(iv.record_status === "current" && iv.conclusion === "rejected")) return false;
      if (["missing", "expired", "invalid"].includes(indep) && iv.record_status !== indep) return false;
    }
    const r = reviewOf(f.id);
    if (starredOnly && !r.starred) return false;
    if (mechSel.size) {
      const g2m = (g2 && g2.mechanisms) || {};
      if (strictEvidences) {
        if (![...mechSel].some(m => strictEvidences.includes(g2m[m]))) return false;
      } else {
        const recall = (c && c.recall_mechanisms) || {};
        if (![...mechSel].some(m => g2m[m] || recall[m])) return false;
      }
    }
    if (topicSel.size) {
      const tp = (g2 && g2.topics) || {};
      if (![...topicSel].some(t => strictEvidences ? strictEvidences.includes(tp[t]) : tp[t])) return false;
    }
    if (purpSel.size) {
      const ps = (g2 && g2.purpose) || [];
      if (![...purpSel].some(p => ps.includes(p))) return false;
    }
    if (strucSel.size) {
      const ss = (g2 && g2.structure) || [];
      if (![...strucSel].some(x => ss.includes(x))) return false;
    }
    if (freeWords.length) {
      const hay = [
        f.title, (f.authors || []).join(" "), f.caption, f.caption_short, f.id,
        (f.visual_patterns || []).join(" "), (f.visual_tags || []).join(" "),
        (f.systems_concepts || []).join(" "), (f.notes_zh || ""),
        f.venue, r.notes, (r.collections || []).join(" "),
        (c && c.caption_original) || "",
        (g2 && g2.takeaway) || "",
        ...Object.keys((g2 && g2.topics) || {}),
        ...explainTexts(c),
      ].join(" ").toLowerCase();
      if (!freeWords.every(w => hay.includes(w))) return false;
    }
    return true;
  });

  const sort = $("#fSort").value;
  if (sort === "venue_year") {
    list.sort((a, b) => String(a.venue).localeCompare(String(b.venue)) || String(b.year).localeCompare(String(a.year)) || String(a.id).localeCompare(String(b.id)));
  } else if (sort === "starred") {
    list.sort((a, b) => Number(reviewOf(b.id).starred) - Number(reviewOf(a.id).starred) || String(a.id).localeCompare(String(b.id)));
  } else if (sort === "curated_science") {
    list.sort((a, b) => ((b.curation && b.curation.science_relevant) || 0) - ((a.curation && a.curation.science_relevant) || 0));
  }
  return list;
}
function explainTexts(c) {
  const e = c && c.explanation;
  if (!e) return [];
  return [e.summary, (e.elements || []).join(" "), e.visual_explanation, e.takeaway, e.limits].filter(Boolean).map(String);
}

/* ---------------- 卡片（图类/机制徽标 + 借鉴点） ---------------- */
const FIG_TYPE_LABEL = { structural: "结构与机制图", quantitative: "定量结果图", mixed: "混合图", other: "其他材料" };
const EV_LABEL = { depicted: ["ev-depicted", "图内描绘"], caption_supported: ["ev-caption_supported", "图注支持"], paper_only: ["ev-paper_only", "仅论文语境"] };

function mechChipsFor(f) {
  const c = contentOf(f.id);
  if (!c) return "";
  const out = [];
  for (const [k, ev] of Object.entries((c.g2 && c.g2.mechanisms) || {})) {
    const [cls, label] = EV_LABEL[ev] || ["ev-paper_only", ev];
    out.push(`<span class="mchip ${cls}">${esc(k.toUpperCase())}·${esc(label)}</span>`);
  }
  if (state.vocab && state.vocab.topics) {
    const TL = Object.fromEntries(state.vocab.topics.map(t => [t.key, t.label]));
    for (const [k, ev] of Object.entries((c.g2 && c.g2.topics) || {})) {
      const [cls, label] = EV_LABEL[ev] || ["ev-paper_only", ev];
      out.push(`<span class="mchip ${cls}" title="主题">${esc(TL[k] || k)}·${esc(label)}</span>`);
    }
  }
  const view = state.ui.view || "usable";
  if (view === "pending" || view === "all") {
    for (const [k, m] of Object.entries(c.recall_mechanisms || {})) {
      if (c.g2 && c.g2.mechanisms && c.g2.mechanisms[k] !== undefined) continue;
      out.push(`<span class="mchip ev-recall" title="召回命中：${esc(m.hit || "")}">${esc(k.toUpperCase())}·召回线索</span>`);
    }
  }
  return out.join("");
}

function cardHtml(f) {
  const r = reviewOf(f.id);
  const c = contentOf(f.id);
  const g2 = c && c.g2;
  const badges = [];
  const c0 = contentOf(f.id);
  const liveOk = liveUsable(f);
  if (c0 && c0.g2 && c0.g2.browse_decision === "usable" && !liveOk)
    badges.push(`<span class="badge bad" title="曾判可用，但当前索引状态（显式拒绝/策展隔离/绑定失效）阻止显示为有效可用">⛔ 当前阻断（见待整理）</span>`);
  else if (g2 && g2.browse_decision === "usable") badges.push(`<span class="badge ok" title="独立目检可用（${esc(g2.code)} · ${esc((g2.reviewed_at || "").slice(0, 10))}）">✔ 可用参考</span>`);
  else if (c && c.zone_reason === "g2_needs_fix") badges.push(`<span class="badge warn">G2 待修裁图</span>`);
  else if (c && c.zone_reason === "g2_not_relevant") badges.push(`<span class="badge warn">G2 不相关</span>`);
  else if (c && c.zone_reason === "production_rejected") badges.push(`<span class="badge bad">生产已拒·仅待整理</span>`);
  else if (c && c.zone_reason === "gpt_needs_fix") badges.push(`<span class="badge warn" title="视觉批次：待修裁图（见详情 issue）">待修裁图</span>`);
  else if (c && c.zone_reason === "gpt_not_relevant") badges.push(`<span class="badge warn">与本库不相关</span>`);
  else if (c && c.zone_reason === "gpt_unsure") badges.push(`<span class="badge warn">待核</span>`);
  else if (c && c.zone_reason === "not_inspected") badges.push(`<span class="badge">未目检·召回线索</span>`);
  if (c && c.fig_type) badges.push(`<span class="badge figtype" title="图类（${esc(c.fig_type_source === "derived_from_g2_purpose_mechanisms" ? "由 G2 标签推导，待视觉批次确认" : c.fig_type_source === "gpt_batch" ? "GPT 视觉批次标注" : "fixture")}）">${esc(FIG_TYPE_LABEL[c.fig_type] || c.fig_type)}</span>`);
  if (f.is_curated) badges.push(`<span class="badge ok" title="${f.curation && f.curation.round && f.curation.round.includes("legacy") ? "旧库 AI 策展映射" : "round3 逐图复检精选"}">★ 模型精选(旧)</span>`);
  if (f.track === "workshop") badges.push(`<span class="badge warn" title="会议 workshop 论文（已核实 DOI/容器来源）">workshop</span>`);
  if (f.crop_status === "needs_recheck") badges.push(`<span class="badge bad">需复审</span>`);
  else if (f.crop_status === "uncropped" || f.crop_status === "nocrop") badges.push(`<span class="badge warn">软拒绝·整页入口</span>`);
  else if (f.crop_status === "pending") badges.push(`<span class="badge">待审</span>`);
  const dups = dupHashPrefixes();
  if (f.perceptual_hash && dups.has(f.perceptual_hash.slice(0, 8))) badges.push(`<span class="badge warn" title="感知哈希前缀相同，人工确认前不合并">疑似重复</span>`);
  if (f.pdf_version) badges.push(`<span class="badge">${esc(f.pdf_version)}</span>`);
  const iv = f.independent || {};
  if (iv.independent_acceptance === true) badges.push(`<span class="badge ok" title="独立视觉审核 current+accepted">独立✔</span>`);
  else if (iv.record_status === "current" && iv.conclusion === "rejected") badges.push(`<span class="badge bad">独立✘拒绝</span>`);
  else if (iv.record_status === "current" && iv.conclusion === "needs_fix") badges.push(`<span class="badge warn">独立⚠需修</span>`);
  const mchips = mechChipsFor(f);
  const tags = [];
  if (g2 && g2.purpose && g2.purpose.length) tags.push(`用途：${g2.purpose.join("·")}`);
  if (g2 && g2.structure && g2.structure.length) tags.push(`结构：${g2.structure.join("·")}`);
  return `
    <div class="hoverbar">
      <button class="hb-star ${r.starred ? "on" : ""}" title="收藏">★</button>
      <button class="hb-cmp ${state.compare.includes(f.id) ? "on" : ""}" title="加入对比">⇔</button>
      <button class="hb-ref ${state.refpack.includes(f.id) ? "on" : ""}" title="加入参考包">🎒</button>
    </div>
    ${(f.thumb || f.image) ? `<img class="fig" loading="lazy" src="${esc(imgUrl(f.thumb || f.image))}" alt="${esc(f.id)}">`
      : `<div class="nocrop-ph">◌ 无独立裁图<br>灯箱可看整页与图注</div>`}
    <div class="cap">
      <b title="${esc(f.title)}">${esc(f.title || f.id)}</b>
      <span class="capline">${esc(f.venue || "?")} ${esc(f.year ?? "")}${f.track ? ` · ${f.track === "workshop" ? "workshop" : esc(f.track)}` : ""} · Fig ${esc(f.figure_number ?? "?")}${f.panel ? esc(f.panel) : ""} · p.${(f.pdf_page_index_0_based ?? 0) + 1}${g2 ? ` · ${esc(g2.code)}` : ""}</span>
      ${mchips ? `<div class="mechchips">${mchips}</div>` : ""}
      ${tags.length ? `<div class="capline">🏷 ${esc(tags.join("｜"))}</div>` : ""}
      ${g2 && g2.takeaway ? `<div class="capline takeaway">💡 ${esc(g2.takeaway)}</div>` : ""}
      ${g2 && g2.issue ? `<div class="capline issue">⚠ ${esc(g2.issue)}</div>` : ""}
      ${badges.length ? `<div class="badges">${badges.join("")}</div>` : ""}
      ${f.visibility === "admin_only" ? `<div class="adminnote">${esc(f.visibility_reason)}</div>` : ""}
    </div>`;
}

function makeCard(f) {
  const card = document.createElement("div");
  const r = reviewOf(f.id);
  card.className = "card" + (r.starred ? " starred" : "");
  card.dataset.id = f.id;
  card.innerHTML = cardHtml(f);
  card.addEventListener("click", (e) => {
    if (e.target.closest(".hoverbar")) return;
    openLightbox(state.order.indexOf(f.id));
  });
  card.querySelector(".hb-star").addEventListener("click", () => toggleStar(f.id));
  card.querySelector(".hb-cmp").addEventListener("click", () => toggleCompare(f.id));
  card.querySelector(".hb-ref").addEventListener("click", () => toggleRefpack(f.id));
  return card;
}

/* ---------------- 网格渲染（增量） ---------------- */
let io = null;
function render() {
  renderInterp();
  updateChips();
  const list = visibleFigures();
  state.order = list.map(f => f.id);
  state.rendered = 0;
  const grid = $("#grid");
  grid.className = "gallery " + (state.ui.density === "source" ? "sourcefirst" : "imagefirst");
  grid.replaceChildren();
  appendMore(PAGE_SIZE);
  $("#empty").hidden = list.length > 0;
  const c = contentCounts();
  $("#resultCount").textContent = `${list.length} / ${state.figures.length} 张（可浏览 ${c.usable}）`;
  updateNote();
  updateFigureFamilies();
}
function updateFigureFamilies() {
  const counts = { structural: 0, quantitative: 0, mixed: 0, other: 0, "": 0 };
  for (const f of state.figures) {
    if (f.fixture || !liveUsable(f)) continue;
    const type = contentOf(f.id)?.fig_type;
    if (type && Object.hasOwn(counts, type)) counts[type]++;
    counts[""]++;
  }
  for (const el of document.querySelectorAll("[data-family-count]")) el.textContent = counts[el.dataset.familyCount];
  for (const b of document.querySelectorAll("#figureFamilies [data-fig-type]")) {
    b.setAttribute("aria-pressed", String(state.ui.view === "usable" && b.dataset.figType === $("#fFigType").value));
  }
}
function appendMore(n) {
  const grid = $("#grid");
  const frag = document.createDocumentFragment();
  const end = Math.min(state.rendered + n, state.order.length);
  for (let i = state.rendered; i < end; i++) frag.appendChild(makeCard(byId(state.order[i])));
  state.rendered = end;
  const btn = $("#loadMore");
  if (end >= state.order.length) { btn.hidden = true; if (io) io.disconnect(); }
  else {
    btn.hidden = false;
    btn.textContent = `加载更多（还有 ${state.order.length - end} 张）`;
    if (io) io.disconnect();
    io = new IntersectionObserver((es) => { if (es[0].isIntersecting) appendMore(PAGE_SIZE); }, { rootMargin: "600px" });
    io.observe(btn);
  }
  grid.appendChild(frag);
}
function completeExplanation(c) {
  // 与接入器一致的完整性规则：四段非空真字符串 + elements/reading_order 各至少一条非空字符串
  const e = c && c.explanation;
  if (!e || typeof e !== "object") return false;
  if (!["summary", "visual_explanation", "takeaway", "limits"].every(k => typeof e[k] === "string" && e[k].trim())) return false;
  if (!Array.isArray(e.elements) || !e.elements.some(x => typeof x === "string" && x.trim())) return false;
  if (!Array.isArray(e.reading_order) || !e.reading_order.some(x => typeof x === "string" && x.trim())) return false;
  return true;
}
function contentCounts() {
  // 公开口径：内部记录（admin_only 等）不混入可用/待整理计数
  let usable = 0, explained = 0, pending = 0, batches = 0;
  for (const f of state.figures) {
    if (f.visibility !== "gallery") continue;
    const c = contentOf(f.id);
    if (liveUsable(f)) {
      usable++;
      if (completeExplanation(c)) explained++;
    } else pending++;
  }
  if (state.content && state.content.batches) batches = Object.keys(state.content.batches).length;
  return { usable, explained, pending, batches };
}
function updateNote() {
  const el = $("#g4NoteCounts");
  if (!el) return;
  const c = contentCounts();
  el.textContent = state.publicSite
    ? `可浏览参考 ${c.usable} 张 · 完整图解 ${c.explained} 张`
    : `当前实际：可浏览参考 ${c.usable} 张 · 完整图解 ${c.explained} 张 · 待整理 ${c.pending} 条（按当前索引实时计算；含被阻断的旧 usable）· 内容批次 ${c.batches}`;
}

/* ---------------- 收藏 / 对比 / 参考包（不变） ---------------- */
function toggleStar(id) {
  const r = reviewOf(id);
  setReview(id, { starred: !r.starred });
  refreshCard(id); updateLightboxActions(); renderTray();
}
function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else {
    if (state.compare.length >= 4) { toast("对比最多 4 张"); return; }
    state.compare.push(id);
  }
  refreshCard(id); renderTray();
}
function toggleRefpack(id) {
  const i = state.refpack.indexOf(id);
  if (i >= 0) state.refpack.splice(i, 1);
  else {
    if (state.refpack.length >= 6) { toast("参考包最多 6 张"); return; }
    state.refpack.push(id);
  }
  refreshCard(id);
  $("#refpackCount").textContent = state.refpack.length;
  toast(`参考包 ${state.refpack.length}/6`);
}
function refreshCard(id) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const f = byId(id), r = reviewOf(id);
  card.classList.toggle("starred", r.starred);
  card.querySelector(".hb-star").classList.toggle("on", r.starred);
  card.querySelector(".hb-cmp").classList.toggle("on", state.compare.includes(id));
  card.querySelector(".hb-ref").classList.toggle("on", state.refpack.includes(id));
}
function renderTray() {
  const tray = $("#compareTray");
  tray.hidden = state.compare.length === 0;
  $("#compareCount").textContent = state.compare.length;
  const items = $("#compareItems");
  items.replaceChildren(...state.compare.map(id => {
    const f = byId(id);
    const div = document.createElement("div");
    div.className = "mini";
    div.innerHTML = `<img src="${esc(imgUrl(f.thumb || f.image))}"><button title="移除">✕</button>`;
    div.querySelector("button").addEventListener("click", () => toggleCompare(id));
    return div;
  }));
}

/* ---------------- 灯箱：左图右解（先读懂，再追来源） ---------------- */
function lbOrder() { return state.lbList || state.order; }
function openLightbox(index) {
  const ord = lbOrder();
  if (index < 0 || index >= ord.length) return;
  state.lbIndex = index;
  const lb = $("#lightbox");
  lb.hidden = false;
  document.body.style.overflow = "hidden";
  fillLightbox();
}
function closeLightbox() {
  $("#lightbox").hidden = true;
  document.body.style.overflow = "";
  state.lbIndex = -1;
  state.lbList = null;
  state.similarReturn = null;
  state.lbStack = [];
  updateBackBtn();
}
function updateBackBtn() {
  const btn = $("#lbBack");
  if (!btn) return;
  btn.hidden = !state.similarReturn;
}
function lbCurrentId() { return lbOrder()[state.lbIndex]; }
function fillLightbox() {
  const f = byId(lbCurrentId());
  if (!f) return;
  const r = reviewOf(f.id);
  setZoom(1, true);
  const img = $("#lbImg");
  if (f.image) {
    img.src = imgUrl(f.image);
    img.style.display = "";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
  }
  img.alt = f.id;
  $("#lbTitle").textContent = `${f.id} · ${f.title || ""} · Fig ${f.figure_number} · ${state.lbIndex + 1}/${state.order.length}`;
  fillExplain(f);
  fillSourceMeta(f);
  $("#lbNotes").value = r.notes || "";
  $("#lbColl").value = (r.collections || []).join(",");
  updateLightboxActions();

  const pb = $("#lbPageBox");
  if (f.page_preview && f.bbox_pdf_points && f.page_geometry) {
    pb.hidden = false; pb.open = false;
    const pimg = $("#lbPageImg");
    pimg.src = imgUrl(f.page_preview);
    pimg.onload = () => {
      const g = f.page_geometry;
      const sx = pimg.clientWidth / g.width_pt, sy = pimg.clientHeight / g.height_pt;
      const [x, y, w, h] = f.bbox_pdf_points;
      const box = $("#lbBbox");
      box.style.left = (x * sx) + "px"; box.style.top = (y * sy) + "px";
      box.style.width = (w * sx) + "px"; box.style.height = (h * sy) + "px";
    };
  } else pb.hidden = true;
  const sb = $("#lbSimilar");
  if (sb) sb.dataset.relaxed = "";  // 换图时重置放宽选择（每图显式选择）
  renderSimilar(f);
}

/* ---------------- 找同类画法（标签共现，非视觉相似度/质量排名） ---------------- */
function computeSimilar(f, relaxed) {
  const cur = contentOf(f.id);
  if (!cur || !cur.g2) return { ok: false, reason: "当前图无目检标签（g2），无法按标签共现查找。" };
  const P = new Set(cur.g2.purpose || []), S = new Set(cur.g2.structure || []);
  if (!S.size || (!P.size && !relaxed)) {
    return { ok: false, reason: relaxed ? "当前图缺结构标签。" : "当前图缺用途或结构标签，无法按共同用途+结构查找。" };
  }
  const shared = [];
  for (const g of state.figures) {
    if (g.id === f.id) continue;
    const cc = contentOf(g.id);
    if (!cc || !cc.g2) continue;
    const p2 = cc.g2.purpose || [], s2 = cc.g2.structure || [];
    const sp = p2.filter(x => P.has(x)), ss = s2.filter(x => S.has(x));
    const pass = relaxed ? ss.length > 0 : (sp.length > 0 && ss.length > 0);
    if (!pass) continue;
    shared.push({ f: g, c: cc, sp, ss });
  }
  const stats = { label_matched: shared.length, excluded_same_paper: 0, excluded_same_hash: 0, excluded_not_eligible: 0, excluded_paper_cap: 0 };
  const pool = [];
  for (const x of shared) {
    if (x.f.paper_id && x.f.paper_id === f.paper_id) { stats.excluded_same_paper++; continue; }
    if (x.f.image_hash && f.image_hash && x.f.image_hash === f.image_hash) { stats.excluded_same_hash++; continue; }
    if (!liveUsable(x.f)) { stats.excluded_not_eligible++; continue; }
    pool.push(x);
  }
  pool.sort((a2, b2) => b2.ss.length - a2.ss.length || b2.sp.length - a2.sp.length || String(a2.f.id).localeCompare(String(b2.f.id)));
  const seenPaper = new Set(), picked = [];
  for (const x of pool) {
    if (picked.length >= 6) break;
    const pid = x.f.paper_id || x.f.id;
    if (seenPaper.has(pid)) { stats.excluded_paper_cap++; continue; }
    seenPaper.add(pid);
    picked.push(x);
  }
  return { ok: true, picked, stats, relaxed };
}
function renderSimilar(f) {
  const box = $("#lbSimilar");
  if (!box) return;
  const relaxed = box.dataset.relaxed === "1";
  const r = computeSimilar(f, relaxed);
  const cur = contentOf(f.id);
  const tags = cur && cur.g2 ? `当前标签：用途 ${(cur.g2.purpose || []).join("·") || "—"}｜结构 ${(cur.g2.structure || []).join("·") || "—"}` : "";
  let html = `<div class="sim-head"><b>🔎 找同类画法</b>
    <label class="sim-toggle" title="放宽后仅要求共享≥1结构，用途不作门槛（候选可能更多、相关性更松）">
      <input type="checkbox" id="simRelax" ${relaxed ? "checked" : ""}> 仅按共同结构
    </label></div>
    <div class="sim-rule">${relaxed
      ? "规则（已放宽）：与当前图共享 ≥1 个结构标签（标签共现，非视觉相似度/质量排名；排序=共同结构数→共同用途数→ID）"
      : "规则：与当前图共享 ≥1 个用途 <b>且</b> ≥1 个结构标签（标签共现，非视觉相似度/质量排名；排序=共同结构数→共同用途数→ID）"}${tags ? "；" + esc(tags) : ""}</div>`;
  if (!r.ok) {
    html += `<div class="sim-empty">未查找：${esc(r.reason)}</div>`;
  } else if (!r.picked.length) {
    const st = r.stats;
    html += `<div class="sim-empty">无候选（如实为空，不拿无关图填满）：共同标签命中 ${st.label_matched} 条` +
      (st.excluded_same_paper ? `，同论文排除 ${st.excluded_same_paper}` : "") +
      (st.excluded_same_hash ? `，相同图片哈希排除 ${st.excluded_same_hash}` : "") +
      (st.excluded_not_eligible ? `，当前不可浏览排除 ${st.excluded_not_eligible}` : "") +
      (st.excluded_paper_cap ? `，每论文最多一张排除 ${st.excluded_paper_cap}` : "") + "。" +
      (!relaxed && st.label_matched === 0 ? " 可尝试勾选「仅按共同结构」放宽。" : "") + `</div>`;
  } else {
    const st = r.stats;
    html += `<div class="sim-stats">共同标签命中 ${st.label_matched} → 展示 ${r.picked.length}（每论文≤1，共 ${new Set(r.picked.map(x => x.f.paper_id || x.f.id)).size} 篇来源${st.excluded_same_paper + st.excluded_same_hash + st.excluded_not_eligible + st.excluded_paper_cap ? `；排除：同论文 ${st.excluded_same_paper}/同哈希 ${st.excluded_same_hash}/不可浏览 ${st.excluded_not_eligible}/每篇上限 ${st.excluded_paper_cap}` : ""}）</div>`;
    html += `<div class="sim-list">` + r.picked.map(x => {
      const g = x.f, cc = x.c;
      const img = g.thumb || g.image;
      return `<div class="sim-card" data-id="${esc(g.id)}">
        ${img ? `<img loading="lazy" src="${esc(imgUrl(img))}" alt="">` : `<div class="sim-noimg">◌</div>`}
        <div class="sim-meta">
          <b title="${esc(g.title)}">${esc((g.title || g.id).slice(0, 44))}</b>
          <span class="capline">${esc(g.venue || "?")} ${esc(g.year ?? "")} · ${esc(cc.g2.code)}${cc.fig_type ? ` · ${esc(FIG_TYPE_LABEL[cc.fig_type] || cc.fig_type)}` : ""}</span>
          <span class="sim-share">共同：用途 ${esc(x.sp.join("·") || "—")}｜结构 ${esc(x.ss.join("·") || "—")}${relaxed && !x.sp.length ? "（放宽模式）" : ""}</span>
          <span class="mechchips">${mechChipsFor(g)}</span>
          <span class="sim-btns">
            <button class="ghost sim-open" data-id="${esc(g.id)}">查看大图</button>
            <button class="ghost sim-star" data-id="${esc(g.id)}" title="收藏（与主画廊共享）">★</button>
            <button class="ghost sim-cmp" data-id="${esc(g.id)}" title="加入对比">⇔</button>
          </span>
        </div>
      </div>`;
    }).join("") + `</div>`;
    html += `<div class="sim-note">候选只按标签共现给出，跨论文≠已证不同正式论文（来源身份未核的如实标注）；"共同结构"不等于同一机制。</div>`;
  }
  box.innerHTML = html;
  const relax = box.querySelector("#simRelax");
  if (relax) relax.addEventListener("change", () => { box.dataset.relaxed = relax.checked ? "1" : ""; renderSimilar(f); });
  for (const b of box.querySelectorAll(".sim-card")) {
    b.addEventListener("click", (ev) => {
      if (ev.target.closest(".sim-star") || ev.target.closest(".sim-cmp")) return;
      const id = ev.currentTarget.dataset.id;
      const from = lbOrder()[state.lbIndex];
      if (from && from !== id) {
        state.lbStack.push({ list: state.lbList ? [...state.lbList] : null, index: state.lbIndex, returnTo: from });
        state.similarReturn = from;
      }
      const cand = (r.ok ? r.picked.map(x => x.f.id) : []);
      state.lbList = [from, ...cand];  // 保留点击目标：导航序=起点+候选（目标必在其中）
      openLightbox(state.lbList.indexOf(id));
      updateBackBtn();
    });
  }
  for (const b of box.querySelectorAll(".sim-star")) b.addEventListener("click", () => toggleStar(b.dataset.id));
  for (const b of box.querySelectorAll(".sim-cmp")) b.addEventListener("click", () => toggleCompare(b.dataset.id));
}

/* 解释面板六段：图讲什么→元素→怎么读→画法作用→借鉴与边界→（折叠）来源 */
function fillExplain(f) {
  const el = $("#lbExplain");
  const c = contentOf(f.id);
  const g2 = c && c.g2;
  const ex = c && c.explanation;
  const page = (f.pdf_page_index_0_based ?? 0) + 1;
  let html = "";
  if (ex) {
    html += `<h4>① 这幅图讲什么</h4><div class="zh">${esc(ex.summary)}</div>`;
    html += `<h4>② 图里元素是什么</h4><ul class="explain-list">${(ex.elements || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>（未提供）</li>"}</ul>`;
    html += `<h4>③ 怎么读</h4><ol class="explain-list">${(ex.reading_order || []).map(x => `<li>${esc(x)}</li>`).join("") || "<li>（未提供）</li>"}</ol>`;
    html += `<h4>④ 这种画法能说明什么</h4><div class="zh">${esc(ex.visual_explanation || "（未提供）")}</div>`;
    html += `<h4>⑤ 可以借鉴什么 · 哪些不能推断</h4><div class="zh">${esc(ex.takeaway || "")}${ex.limits ? `<div class="limits">⚠ ${esc(ex.limits)}</div>` : ""}</div>`;
    html += `<div class="explain-src">图解：${esc(ex.model || "?")} · ${esc((ex.explained_at || "").slice(0, 10))} · 绑定 hash ${esc(String(f.image_hash || c.image_sha256 || "—").slice(0, 10))}…</div>`;
  } else {
    const placeholder = `<div class="zh muted">详细图解待整理（G4 视觉批次，逐图目检后填写——工程不代填）。</div>`;
    const head = g2 && g2.takeaway
      ? `<h4>① 这幅图讲什么</h4><div class="zh">${esc(g2.takeaway)}<span class="muted">（G2 短借鉴点，非完整图解）</span></div>`
      : `<h4>① 这幅图讲什么</h4><div class="zh muted">${g2 ? "（待 G4 视觉批次）" : "未目检——仅有召回线索，见下方原始图注与来源。"}</div>`;
    html += head;
    html += `<h4>② 图里元素是什么</h4>${placeholder}`;
    html += `<h4>③ 怎么读</h4>${placeholder}`;
    html += `<h4>④ 这种画法能说明什么</h4>${placeholder}`;
    html += `<h4>⑤ 可以借鉴什么 · 哪些不能推断</h4>${g2 && g2.takeaway ? `<div class="zh">${esc(g2.takeaway)}</div>` : placeholder}`;
  }
  if (c && c.fig_type) html = `<div class="figtype-line">图类：<b>${esc(FIG_TYPE_LABEL[c.fig_type] || c.fig_type)}</b>（${esc(c.fig_type_source === "derived_from_g2_purpose_mechanisms" ? "G2 标签推导，待视觉确认" : c.fig_type_source === "gpt_batch" ? "GPT 视觉批次" : c.fig_type_source === "fixture" ? "fixture" : "?")}）</div>` + html;
  el.innerHTML = html;
}

function fillSourceMeta(f) {
  const meta = $("#lbMeta");
  const c = contentOf(f.id);
  const page = (f.pdf_page_index_0_based ?? 0) + 1;
  meta.innerHTML = `
  <details class="explain-src-box">
    <summary>⑥ 原始图注 · 来源与追溯（点开）</summary>
    <div class="row"><b>出处</b>：${esc(f.venue || "?")} ${esc(f.year ?? "")}${f.track ? ` · ${f.track === "workshop" ? "workshop 轨" : f.track === "main_conference" ? "主会" : esc(f.track)}` : ""}${f.source_verified ? ' <span style="color:var(--ok)">✓来源已核</span>' : ' <span class="zh">来源未核</span>'}${f.pdf_version ? `（PDF 版本：${esc(f.pdf_version)}）` : ""}${f.publication_status === "preprint" ? " · 预印本" : ""}</div>
    ${f.authors ? `<div class="row"><b>作者</b>：${esc(f.authors.join(", "))}</div>` : ""}
    <div class="row"><b>图号</b>：Figure ${esc(f.figure_number)}${f.panel ? " panel " + esc(f.panel) : ""} · PDF 第 ${page} 页</div>
    ${(f.caption || (c && c.caption_original)) ? `<div class="caption">${esc(f.caption || c.caption_original)}</div>` : `<div class="caption" style="color:var(--muted)">（图注未导入）</div>`}
    ${f.landing_url ? `<div class="row"><a href="${esc(f.landing_url)}" target="_blank" rel="noopener">论文页 ↗</a>${f.pdf_url ? ` · <a href="${esc(f.pdf_url)}" target="_blank" rel="noopener">PDF ↗</a>` : ""}${f.page_preview ? ` · <a href="${esc(imgUrl(f.page_preview))}" target="_blank" rel="noopener">整页图 ↗</a>` : ""}</div>` : ""}
    <div class="row"><b>状态</b>：${esc(f.crop_status)}${f.review ? ` · 审核：${esc(f.review.reviewer_type || "")} (${esc(f.review.reviewed_at || "")})` : " · 未审核"}</div>
    <div class="row"><b>溯源</b>：${esc(f.extraction_method || "")}${f.bbox_source === "manual_override" ? " · bbox 人工修正" : ""}</div>
    ${f.curation && (f.curation.observation_facts || f.curation.design_notes) ? `
      <details class="curation-box"><summary>旧模型策展记录（历史参考，非当前口径）</summary>
        ${f.curation.observation_facts && f.curation.observation_facts.figure_kind ? `<div class="zh"><b>实际图型</b>：${esc(f.curation.observation_facts.figure_kind)}</div>` : ""}
        ${f.curation.observation_facts && f.curation.observation_facts.visible_summary ? `<div class="zh"><b>观察</b>：${esc(f.curation.observation_facts.visible_summary)}</div>` : ""}
        ${f.curation.design_notes && f.curation.design_notes.visual_thesis ? `<div class="zh">图意：${esc(f.curation.design_notes.visual_thesis)}</div>` : ""}
        ${f.curation.design_notes && f.curation.design_notes.reading_order ? `<div class="zh">阅读顺序：${esc(f.curation.design_notes.reading_order)}</div>` : ""}
        ${f.curation.design_notes && f.curation.design_notes.borrow ? `<div class="zh">可借鉴：${esc(f.curation.design_notes.borrow)}</div>` : ""}
        ${f.curation.design_notes && f.curation.design_notes.not_to_copy ? `<div class="zh">不能照搬：${esc(f.curation.design_notes.not_to_copy)}</div>` : ""}
      </details>` : ""}
    ${(f.visual_tags || []).length ? `<div class="row"><b>视觉标签</b>：${f.visual_tags.map(esc).join(" · ")}</div>` : ""}
    ${f.visibility === "admin_only" ? `<div class="adminnote">仅管理视图：${esc(f.visibility_reason)}</div>` : ""}
  </details>`;
}
function updateLightboxActions() {
  const f = state.lbIndex >= 0 ? byId(lbCurrentId()) : null;
  if (!f) return;
  const r = reviewOf(f.id);
  $("#lbStar").classList.toggle("on", r.starred);
  $("#lbStar").textContent = r.starred ? "★ 已收藏" : "☆ 收藏";
  $("#lbLike").classList.toggle("on", r.rating === "like");
  $("#lbDislike").classList.toggle("on", r.rating === "dislike");
  $("#lbCompareAdd").classList.toggle("on", state.compare.includes(f.id));
  $("#lbRefAdd").classList.toggle("on", state.refpack.includes(f.id));
}
function lbStep(d) {
  const n = lbOrder().length;
  if (!n) return;
  openLightbox((state.lbIndex + d + n) % n);
}
/* 缩放与拖拽 */
function setZoom(z, reset) {
  state.zoom = Math.min(8, Math.max(0.15, z));
  const img = $("#lbImg");
  img.style.transform = `scale(${state.zoom})`;
  if (reset) { img.style.left = "0"; img.style.top = "0"; }
  img.style.cursor = state.zoom > 1 ? "grab" : "";
}
function bindPan() {
  const img = $("#lbImg"), stage = $("#lbStage");
  let drag = null;
  img.addEventListener("mousedown", (e) => { if (state.zoom > 1) { drag = { x: e.clientX, y: e.clientY, l: img.offsetLeft, t: img.offsetTop }; e.preventDefault(); } });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    img.style.left = (drag.l + e.clientX - drag.x) + "px";
    img.style.top = (drag.t + e.clientY - drag.y) + "px";
  });
  window.addEventListener("mouseup", () => { drag = null; });
  stage.addEventListener("wheel", (e) => {
    if (!$("#lightbox").hidden) { e.preventDefault(); setZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 0.87)); }
  }, { passive: false });
}

/* ---------------- 对比视图 ---------------- */
function openCompare() {
  if (state.compare.length < 2) { toast("请先选择 2–4 张图", true); return; }
  const cols = $("#cvCols");
  cols.style.gridTemplateColumns = `repeat(${state.compare.length}, 1fr)`;
  cols.replaceChildren(...state.compare.map(id => {
    const f = byId(id);
    const div = document.createElement("div");
    div.className = "cv-col";
    const c = contentOf(id);
    const g2 = c && c.g2;
    div.innerHTML = `
      <div class="cv-img"><img src="${esc(imgUrl(f.image))}" alt=""></div>
      <div class="cv-meta"><b>${esc(f.title || f.id)}</b>
        ${esc(f.venue || "?")} ${esc(f.year ?? "")} · Fig ${esc(f.figure_number ?? "?")} · ${esc(f.id)}${c && c.fig_type ? ` · ${esc(FIG_TYPE_LABEL[c.fig_type])}` : ""}<br>
        ${g2 && g2.takeaway ? `💡 ${esc(g2.takeaway)}<br>` : ""}${esc((f.caption || (c && c.caption_original) || f.caption_short || "").slice(0, 300))}${(f.caption || "").length > 300 ? "…" : ""}</div>`;
    div.querySelector("img").addEventListener("click", (e) => {
      const w = window.open("", "_blank");
      w.document.write(`<title>${esc(f.id)}</title><body style="margin:0;background:#222;display:flex;align-items:center;justify-content:center;height:100vh"><img src="${esc(imgUrl(f.image))}" style="max-width:96vw;max-height:96vh"></body>`);
    });
    return div;
  }));
  $("#compareView").hidden = false;
}

/* ---------------- 参考包（不变） ---------------- */
function openRefpack() {
  if (state.refpack.length < 2) { toast("参考包需要 2–6 张", true); return; }
  const list = $("#rpList");
  list.replaceChildren(...state.refpack.map(id => {
    const f = byId(id);
    const div = document.createElement("div");
    div.className = "rp-item"; div.dataset.id = id;
    div.innerHTML = `
      <img src="${esc(imgUrl(f.thumb || f.image))}" alt="">
      <div class="rp-fields">
        <h4>${esc(f.title || f.id)} · Fig ${esc(f.figure_number ?? "?")} · ${esc(f.venue || "?")} ${esc(f.year ?? "")}</h4>
        <div class="rp-state"></div>
        <textarea class="rp-borrow" rows="2" placeholder="借鉴点：要学什么">${esc((f.transferable_moves || []).join("；"))}</textarea>
        <textarea class="rp-avoid" rows="2" placeholder="禁止照搬：哪些机制/结论不能抄">${esc((f.not_to_copy || []).join("；"))}</textarea>
        <div class="path">${state.publicSite ? `<a href="${esc(imgUrl(f.image))}" target="_blank" rel="noopener">打开参考图 ↗</a>` : `${esc(state.projectRoot)}\\${esc((f.image || "").replace(/\//g, "\\"))}`}</div>
      </div>`;
    const update = () => {
      const el = div.querySelector(".rp-state");
      const reasons = RefpackGuard.formalBlockReasons(f).slice();
      if (!div.querySelector(".rp-borrow").value.trim()) reasons.push("借鉴点（borrow）被清空");
      if (!div.querySelector(".rp-avoid").value.trim()) reasons.push("不可照搬（do_not_copy）被清空");
      div.classList.toggle("rp-blocked", reasons.length > 0);
      el.className = "rp-state " + (reasons.length ? "rp-warn" : "rp-ok");
      el.textContent = reasons.length
        ? `⚠ 不能进正式包：${reasons.join("；")}（可浏览，导出时将被拦截）`
        : `✓ 正式可用（track=${f.track || "unknown"}，来源已验证）`;
    };
    div.querySelector(".rp-borrow").addEventListener("input", update);
    div.querySelector(".rp-avoid").addEventListener("input", update);
    update();
    return div;
  }));
  $("#rpCount").textContent = state.refpack.length;
  $("#refpack").hidden = false;
}
function refpackManifest() {
  const items = [...document.querySelectorAll(".rp-item")].map(el => ({
    id: el.dataset.id,
    borrow: el.querySelector(".rp-borrow").value.trim(),
    avoid: el.querySelector(".rp-avoid").value.trim(),
  }));
  const manifest = RefpackGuard.buildManifest(items, byId, state.projectRoot);
  if (state.publicSite) {
    manifest.usage = "参考图版权归原作者与出版者；请核对原文与适用许可。本图解为模型整理，参考包资格不代表版权授权。";
    for (const entry of [...manifest.figures, ...manifest.blocked.map(b => b.entry).filter(Boolean)]) {
      entry.image_url = imgUrl(entry.local_image_relpath);
      delete entry.local_image_relpath;
    }
  }
  if (manifest.blocked.length) {
    toast(`参考包导出：${manifest.figures.length} 条正式可用，${manifest.blocked.length} 条被拦截（详见 manifest.blocked）`, true);
  } else {
    toast(`参考包导出：${manifest.figures.length} 条全部通过正式检查`);
  }
  return manifest;
}
function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- 偏好导出/导入（不变） ---------------- */
function exportReviews() {
  const out = { format: "sfa-reviews", version: 1, exported_at: new Date().toISOString(), reviews: state.reviews };
  downloadJSON(out, `sfa_reviews_${new Date().toISOString().slice(0, 10)}.json`);
  toast("已导出偏好 JSON");
}
function importReviews(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      const reviews = obj.reviews || obj;
      if (typeof reviews !== "object") throw new Error("bad format");
      let n = 0;
      for (const [id, r] of Object.entries(reviews)) {
        if (byId(id)) { state.reviews[id] = r; n++; }
      }
      saveReviews(); render(); renderTray();
      toast(`已导入 ${n} 条偏好`);
    } catch (e) { toast("导入失败：" + e.message, true); }
  };
  reader.readAsText(file);
}

/* ---------------- 初始化 ---------------- */
function fillFacetSelect(sel, facet, label) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${label}</option>` + facet.map(x =>
    `<option value="${esc(x.value)}">${esc(x.value)} (${x.count})</option>`).join("");
  sel.value = cur;
}
function fillChips() {
  if (!state.vocab) return;
  const mk = (barId, dim) => {
    const bar = $(barId);
    bar.querySelectorAll("label.chip").forEach(e => e.remove());
    for (const [k, label] of dim) {
      const l = document.createElement("label");
      l.className = "chip"; l.dataset.k = k;
      l.innerHTML = `<input type="checkbox" data-k="${esc(k)}"><span>${esc(label)} <span class="cnt">0</span></span>`;
      bar.appendChild(l);
    }
  };
  mk("#mechBar", Object.entries(state.vocab.mechanisms).map(([k, v]) => [k, v.label]));
  mk("#topicBar", state.vocab.topics.map(t => [t.key, t.label.split(" · ")[0]]));
  mk("#purposeBar", state.vocab.purposes.map(p => [p, p]));
  mk("#structureBar", state.vocab.structures.map(s => [s, s]));
}
function updateChips() {
  for (const [barId, set] of [["#mechBar", state.mech], ["#topicBar", state.topic], ["#purposeBar", state.purpose], ["#structureBar", state.structure]]) {
    const bar = $(barId);
    if (!bar) continue;
    bar.querySelectorAll("label.chip").forEach(el => {
      const k = el.dataset.k;
      el.querySelector("input").checked = set.has(k);
      let n = 0;
      const view = state.ui.view || "usable";
      const strict = view === "mech" ? ["depicted"] : (view === "usable" || view === "exp") ? ["depicted", "caption_supported"] : null;
      for (const f of state.figures) {
        if (!viewFilter(f)) continue;
        const c = contentOf(f.id);
        if (barId === "#mechBar") {
          const g2m = (c && c.g2 && c.g2.mechanisms) || {};
          if (strict ? strict.includes(g2m[k]) : (g2m[k] || ((c && c.recall_mechanisms) || {})[k])) n++;
        } else if (barId === "#topicBar") {
          const tp = (c && c.g2 && c.g2.topics) || {};
          if (strict ? strict.includes(tp[k]) : tp[k]) n++;
        } else if (barId === "#purposeBar") {
          if (c && c.g2 && (c.g2.purpose || []).includes(k)) n++;
        } else {
          if (c && c.g2 && (c.g2.structure || []).includes(k)) n++;
        }
      }
      el.querySelector(".cnt").textContent = n;
    });
  }
}
function setView(v, figType = "") {
  state.ui.view = v;
  $("#fFigType").value = figType;
  state.ui.figType = $("#fFigType").value;
  for (const b of document.querySelectorAll("#viewbar .viewtab")) {
    b.classList.toggle("on", b.dataset.view === v);
  }
  saveUI(); render();
}
async function init() {
  const params = new URLSearchParams(location.search);
  state.showFixture = params.get("fixture") === "1";
  const res = await fetch("data/index.json");
  if (!res.ok) { toast("画廊数据加载失败，请刷新重试；本地使用需先启动服务器。", true); return; }
  const idx = await res.json();
  state.figures = idx.figures;
  state.projectRoot = idx.project_root || "";
  state.assetBase = idx.asset_base || "/";
  state.publicSite = idx.public_site === true;
  if (state.publicSite) {
    state.ui.admin = "0";
    state.showFixture = false;
    $("#btnAdmin").hidden = true;
    document.querySelectorAll('[data-view="pending"], [data-view="curated"]').forEach(el => { el.hidden = true; });
    $("#publicNotice").hidden = false;
    $("#g4Note").innerHTML = '<summary>内容说明 <span id="g4NoteCounts"></span></summary>本公开版收录经模型目检并整理图解的可浏览参考。标签、解释与图注可能存在误差，请结合论文核对；图中实验结果不能直接迁移到自己的系统。';
    const allTab = document.querySelector('[data-view="all"]');
    allTab.textContent = "全部参考";
    allTab.title = "本公开版全部可浏览参考";
    $("#empty").textContent = "没有匹配的参考图，可以减少筛选条件或换一个关键词。";
  }
  try {
    const cres = await fetch("data/gallery_content.json");
    if (cres.ok) {
      const content = await cres.json();
      state.content = content;
      state.vocab = content.vocabularies;
      const fixtureFigures = (content.fixtures || []).map(fx => ({
        id: fx.id, fixture: true, visibility: "gallery", crop_status: "ok",
        image: fx.image || null, thumb: fx.thumb || null, page_preview: fx.page_preview || null,
        title: fx.title || fx.id, venue: "FIXTURE", year: 2026, figure_number: "F",
        paper_id: fx.paper_id || null, image_hash: fx.image_hash || null,
        pdf_page_index_0_based: 0, perceptual_hash: null, landing_url: null,
        __contentFixture: fx,
      }));
      // fixture 内容并入 content.entries 供 contentOf 查询
      for (const fx of content.fixtures || []) content.entries[fx.id] = fx;
      if (state.showFixture) state.figures = [...state.figures, ...fixtureFigures];
    }
  } catch { /* 内容文件可缺：退化为纯旧画廊 */ }
  for (const [k, facet] of Object.entries(idx.facets)) {
    const map = { venue: ["#fVenue", "全部会议"], year: ["#fYear", "全部年份"],
      figure_purpose: ["#fPurpose", "全部图型(旧)"], visual_pattern: ["#fPattern", "全部视觉模式"],
      track: ["#fTrack", "全部轨道"], visual_tag: ["#fTag", "全部视觉标签"] };
    if (map[k]) fillFacetSelect($(map[k][0]), facet, map[k][1]);
  }
  const fs2 = $("#fStatus");
  fs2.innerHTML = `<option value="">全部状态</option>
    <option value="ok">已审通过</option><option value="pending">待审</option>
    <option value="needs_recheck">需复审</option><option value="nocrop">软拒绝</option>
    <option value="excluded">已排除</option><option value="suspect-dup">疑似重复</option>`;
  state.ui.density = state.ui.density || "image";
  let view = state.ui.view || "usable";
  // URL 参数（含 parallelism 旧链兼容）：view/zone/mech/purpose/structure/fig_type/q
  const zoneMap = { direct: "mech", analogy: "exp", pending: "pending", all: "all", mechanism: "mech", experiments: "exp", usable: "usable" };
  if (params.get("zone")) view = zoneMap[params.get("zone")] || view;
  if (params.get("view")) view = params.get("view");
  if (!VIEWS[view]) view = "usable";
  if (state.publicSite && ["pending", "curated"].includes(view)) view = "usable";
  state.ui.view = view;
  if (params.get("mech")) params.get("mech").split(",").forEach(k => state.mech.add(k));
  if (params.get("purpose")) params.get("purpose").split(",").forEach(k => state.purpose.add(k));
  if (params.get("structure")) params.get("structure").split(",").forEach(k => state.structure.add(k));
  if (params.get("topic")) params.get("topic").split(",").forEach(k => state.topic.add(k));
  // Explicit old view/zone links retain their scope; a fresh main visit starts with diagrams.
  const explicitScope = params.has("view") || params.has("zone");
  const initialType = params.has("fig_type") ? params.get("fig_type")
    : explicitScope || view !== "usable" ? "" : (state.ui.figType ?? "structural");
  $("#fFigType").value = initialType;
  state.ui.figType = $("#fFigType").value;
  if (params.get("q")) {
    $("#search").value = params.get("q");
    const p = parseQuery(params.get("q"));
    state.qMech = p.mech; state.qPurpose = p.purpose; state.qStructure = p.structure; state.qFree = p.free;
  }
  fillChips();
  for (const b of document.querySelectorAll("#viewbar .viewtab")) {
    b.classList.toggle("on", b.dataset.view === view);
  }
  $("#btnDensity").textContent = state.ui.density === "image" ? "看图优先" : "看来源";
  if (state.ui.admin === "1") { $("#btnAdmin").classList.add("on"); }
  bindEvents(); bindPan(); render(); renderTray();
}
function bindEvents() {
  document.querySelectorAll("#figureFamilies [data-fig-type]").forEach(b =>
    b.addEventListener("click", () => setView("usable", b.dataset.figType)));
  $("#search").addEventListener("input", (ev) => {
    const p = parseQuery(ev.target.value);
    state.qMech = p.mech; state.qPurpose = p.purpose; state.qStructure = p.structure; state.qFree = p.free;
    render();
  });
  for (const s of ["#fVenue", "#fYear", "#fPurpose", "#fPattern", "#fTrack",
                   "#fTag", "#fStatus", "#fInd", "#fSort", "#fFigType"]) {
    if ($(s)) { $(s).addEventListener("input", render); $(s).addEventListener("change", render); }
  }
  for (const [barId, set] of [["#mechBar", state.mech], ["#topicBar", state.topic], ["#purposeBar", state.purpose], ["#structureBar", state.structure]]) {
    const bar = $(barId);
    if (!bar) continue;
    bar.addEventListener("change", (ev) => {
      const k = ev.target.dataset.k;
      if (!k) return;
      if (ev.target.checked) set.add(k); else set.delete(k);
      render();
    });
  }
  $("#fStarred").addEventListener("change", render);
  document.querySelectorAll("#viewbar .viewtab").forEach(b =>
    b.addEventListener("click", () => setView(b.dataset.view)));
  $("#loadMore").addEventListener("click", () => appendMore(PAGE_SIZE));
  $("#btnDensity").addEventListener("click", () => {
    state.ui.density = state.ui.density === "image" ? "source" : "image";
    $("#btnDensity").textContent = state.ui.density === "image" ? "看图优先" : "看来源";
    saveUI(); render();
  });
  $("#btnAdmin").addEventListener("click", () => {
    if (state.publicSite) return;
    state.ui.admin = state.ui.admin === "1" ? "0" : "1";
    $("#btnAdmin").classList.toggle("on", state.ui.admin === "1");
    saveUI(); render();
  });
  $("#btnExport").addEventListener("click", exportReviews);
  $("#btnImport").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => { if (e.target.files[0]) importReviews(e.target.files[0]); e.target.value = ""; });

  $("#lbClose").addEventListener("click", closeLightbox);
  const backBtn = $("#lbBack");
  if (backBtn) backBtn.addEventListener("click", () => {
    const prev = state.lbStack.pop();
    state.similarReturn = state.lbStack.length ? state.lbStack[state.lbStack.length - 1].returnTo : null;
    if (prev) {
      state.lbList = prev.list ? [...prev.list] : null;
      openLightbox(prev.list ? Math.min(prev.index, prev.list.length - 1) : Math.max(0, state.order.indexOf(prev.returnTo)));
    }
    updateBackBtn();
  });
  $("#lbPrev").addEventListener("click", () => lbStep(-1));
  $("#lbNext").addEventListener("click", () => lbStep(1));
  $("#lbZoomIn").addEventListener("click", () => setZoom(state.zoom * 1.25));
  $("#lbZoomOut").addEventListener("click", () => setZoom(state.zoom / 1.25));
  $("#lbZoomReset").addEventListener("click", () => setZoom(1, true));
  $("#lbStar").addEventListener("click", () => toggleStar(lbCurrentId()));
  $("#lbLike").addEventListener("click", () => { const id = lbCurrentId(); setReview(id, { rating: reviewOf(id).rating === "like" ? null : "like" }); updateLightboxActions(); });
  $("#lbDislike").addEventListener("click", () => { const id = lbCurrentId(); setReview(id, { rating: reviewOf(id).rating === "dislike" ? null : "dislike" }); updateLightboxActions(); });
  $("#lbCompareAdd").addEventListener("click", () => toggleCompare(lbCurrentId()));
  $("#lbRefAdd").addEventListener("click", () => toggleRefpack(lbCurrentId()));
  // 快切保存边界（handoff22 A）：按 ID 独立计时——不同图的防抖互不取消；
  // 输入时捕获 (id, value)，切图/关闭后回调仍按捕获值落盘；同图连续输入只保留最新一次。
  const notesTimers = {};
  $("#lbNotes").addEventListener("input", (e) => {
    const id = lbCurrentId(), value = e.target.value;
    if (!id) return;
    clearTimeout(notesTimers[id]);
    notesTimers[id] = setTimeout(() => { delete notesTimers[id]; setReview(id, { notes: value }); }, 400);
  });
  $("#lbCollSave").addEventListener("click", () => {
    const v = $("#lbColl").value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    setReview(lbCurrentId(), { collections: v });
    toast("收藏夹已保存");
  });

  $("#btnCompare").addEventListener("click", openCompare);
  $("#btnCompareClear").addEventListener("click", () => { state.compare = []; render(); renderTray(); });
  $("#cvClose").addEventListener("click", () => { $("#compareView").hidden = true; });

  $("#rpClose").addEventListener("click", () => { $("#refpack").hidden = true; });
  $("#btnRefpackOpen").addEventListener("click", openRefpack);
  $("#rpManifest").addEventListener("click", () => { downloadJSON(refpackManifest(), `sfa_refpack_${Date.now()}.json`); toast("manifest 已下载"); });
  $("#rpCopy").addEventListener("click", async () => {
    const lines = [...document.querySelectorAll(".rp-item .path")].map(e => e.textContent);
    try { await navigator.clipboard.writeText(lines.join("\n")); toast("图片绝对路径已复制"); }
    catch { toast("复制失败：manifest 中也包含路径", true); }
  });

  document.addEventListener("keydown", (e) => {
    const lbOpen = !$("#lightbox").hidden;
    const cvOpen = !$("#compareView").hidden;
    const rpOpen = !$("#refpack").hidden;
    if (e.key === "Escape") {
      if (rpOpen) { $("#refpack").hidden = true; }
      else if (cvOpen) { $("#compareView").hidden = true; }
      else if (lbOpen) closeLightbox();
      return;
    }
    if (!lbOpen || e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") lbStep(-1);
    else if (e.key === "ArrowRight") lbStep(1);
    else if (e.key === "+" || e.key === "=") setZoom(state.zoom * 1.25);
    else if (e.key === "-") setZoom(state.zoom / 1.25);
    else if (e.key === "0") setZoom(1, true);
  });
}
init();
