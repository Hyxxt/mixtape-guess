(function () {
  const REGION_ORDER = ["全部", "华北", "华东", "华中", "华南", "西南", "西北", "东北"];
  const REGION_COLORS = {
    "华北": { bg: "#B45309", grad: "from-amber-700 to-stone-800" },
    "华东": { bg: "#0F766E", grad: "from-teal-700 to-slate-800" },
    "华中": { bg: "#C84B31", grad: "from-orange-700 to-rose-900" },
    "华南": { bg: "#0369A1", grad: "from-sky-700 to-cyan-900" },
    "西南": { bg: "#2D6A4F", grad: "from-emerald-700 to-teal-900" },
    "西北": { bg: "#9A3412", grad: "from-amber-800 to-orange-950" },
    "东北": { bg: "#1D4ED8", grad: "from-blue-700 to-indigo-900" }
  };

  const DATA_KEY = "shanhe_travel_dataset_v1";
  const VIEWS = ["explore", "map", "insights", "wishlist"];
  let appData;
  let defaultData;
  let imported = false;
  let detailTrigger;
  let compareTrigger;

  const state = {
    view: "explore",
    region: "全部",
    search: "",
    days: "all",
    month: 0,
    budget: 0,
    sort: "default",
    wishlist: savedIds("china_travel_wishlist"),
    compareIds: [],
    activeDestId: null,
    activeItinTab: "threeDays",
    mapRegion: "全部",
    mapFocusedId: null,
    mapStyle: "std"
  };

  let mapInstance = null;
  let mapTileLayer = null;
  let cityMarkersLayer = null;
  let spotMarkersLayer = null;
  let regionChartInst = null;
  let seasonChartInst = null;

  function loadSaved(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveKey(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch {
      return false;
    }
  }

  function savedIds(key) {
    const ids = loadSaved(key, []);
    return Array.isArray(ids) ? ids.filter(id => typeof id === "string") : [];
  }

  function validateData(data) {
    const record = value => value && typeof value === "object" && !Array.isArray(value);
    const strings = value => Array.isArray(value) && value.every(item => typeof item === "string");
    const coords = value => value == null || (record(value) && Number.isFinite(value.lat) && Math.abs(value.lat) <= 90 && Number.isFinite(value.lng) && Math.abs(value.lng) <= 180);
    const optional = (value, test) => value == null || test(value);
    const ids = new Set();
    if (!record(data) || !Array.isArray(data.destinations) || !data.destinations.length || data.destinations.length > 300) return false;
    if (!optional(data.meta, meta => record(meta) && optional(meta.sources, strings))) return false;
    return data.destinations.every(city => {
      if (!record(city) || typeof city.id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(city.id) || ids.has(city.id) ||
        typeof city.name !== "string" || !city.name.trim() || !REGION_ORDER.slice(1).includes(city.region)) return false;
      ids.add(city.id);
      if (![city.tags, city.food, city.tips].every(value => optional(value, strings)) || !coords(city.coords)) return false;
      if (!optional(city.spots, spots => Array.isArray(spots) && spots.every(spot => record(spot) && typeof spot.name === "string" && coords(spot.coords)))) return false;
      if (!optional(city.seasonPrice, seasons => record(seasons) && ["peak", "shoulder", "off"].every(key =>
        optional(seasons[key], season => record(season) && typeof season.range === "string" && Array.isArray(season.months) &&
          season.months.every(month => Number.isInteger(month) && month >= 1 && month <= 12))))) return false;
      return optional(city.itineraries, itineraries => record(itineraries) && ["threeDays", "fiveDays"].every(key =>
        optional(itineraries[key], days => Array.isArray(days) && days.every(day => record(day) && Number.isInteger(day.day) &&
          optional(day.notes, strings) && optional(day.items, items => Array.isArray(items) && items.every(record))))));
    });
  }

  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add("hidden"), 2400);
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getImageUrl(dest) {
    const img = dest.image || {};
    if (typeof img.file === "string" && /^images\/[a-z0-9_-]+\.webp$/i.test(img.file)) return img.file;
    if (typeof img.title === "string" && img.title) {
      return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(img.title) + "?width=800";
    }
    return "";
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function parseMinBudget(budgetStr) {
    const m = String(budgetStr || "").replace(/(\d),(?=\d)/g, "$1").match(/\d+/);
    return m ? parseInt(m[0], 10) : 99999;
  }

  function budgetFor(dest) {
    return getSeasonForMonth(dest, state.month)?.range ?? dest.budget;
  }

  function matchDaysBucket(daysStr, bucket) {
    if (bucket === "all") return true;
    const nums = (String(daysStr || "").match(/\d+/g) || []).map(Number);
    if (!nums.length) return true;
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    if (bucket === "short") return hi <= 2;
    if (bucket === "medium") return lo <= 3 && hi >= 2 && hi <= 3;
    if (bucket === "classic") return lo <= 4 && hi >= 3 && hi <= 4;
    if (bucket === "deep") return hi >= 4;
    return true;
  }

  function getSeasonForMonth(dest, month) {
    if (!month || !dest.seasonPrice) return null;
    const sp = dest.seasonPrice;
    if (sp.peak && Array.isArray(sp.peak.months) && sp.peak.months.includes(month)) {
      return { key: "peak", label: "旺季", range: sp.peak.range, note: sp.peak.note, badgeClass: "bg-[#C84B31] text-white" };
    }
    if (sp.shoulder && Array.isArray(sp.shoulder.months) && sp.shoulder.months.includes(month)) {
      return { key: "shoulder", label: "平季", range: sp.shoulder.range, note: sp.shoulder.note, badgeClass: "bg-[#D97706] text-white" };
    }
    if (sp.off && Array.isArray(sp.off.months) && sp.off.months.includes(month)) {
      return { key: "off", label: "淡季", range: sp.off.range, note: sp.off.note, badgeClass: "bg-[#2D6A4F] text-white" };
    }
    return null;
  }

  function getFilteredDestinations() {
    const q = state.search.trim().toLowerCase();
    let list = appData.destinations.filter(d => {
      if (state.region !== "全部" && d.region !== state.region) return false;
      if (!matchDaysBucket(d.days, state.days)) return false;
      if (state.budget && parseMinBudget(budgetFor(d)) > state.budget) return false;
      if (q) {
        const hay = [
          d.name, d.province, d.region, d.tagline, d.hotSource,
          ...(d.tags || []),
          ...(d.food || []),
          ...(d.spots || []).map(s => s.name)
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (state.sort === "budget_asc") {
      list.sort((a, b) => parseMinBudget(budgetFor(a)) - parseMinBudget(budgetFor(b)));
    } else if (state.sort === "spots_desc") {
      list = [...list].sort((a, b) => (b.spots || []).length - (a.spots || []).length);
    } else if (state.sort === "off_first") {
      const m = state.month || (new Date().getMonth() + 1);
      const rank = { off: 0, shoulder: 1, peak: 2 };
      list = [...list].sort((a, b) => {
        const sa = getSeasonForMonth(a, m);
        const sb = getSeasonForMonth(b, m);
        return (sa ? rank[sa.key] : 3) - (sb ? rank[sb.key] : 3);
      });
    }
    return list;
  }

  function renderCard(dest) {
    const isFav = state.wishlist.includes(dest.id);
    const isCmp = state.compareIds.includes(dest.id);
    const regColor = REGION_COLORS[dest.region] || { bg: "#5C6370", grad: "from-slate-700 to-slate-900" };
    const imgUrl = getImageUrl(dest);
    const img = dest.image || {};
    const seasonInfo = state.month ? getSeasonForMonth(dest, state.month) : null;
    const displayBudget = budgetFor(dest);
    const licenseUrl = safeUrl(img.licenseUrl);

    return `
      <article class="bg-white rounded-3xl border border-[#E8E2D9] overflow-hidden card-hover flex flex-col cursor-pointer dest-card" data-id="${esc(dest.id)}">
        <div class="relative aspect-[16/10] bg-gradient-to-br ${regColor.grad} overflow-hidden">
          <div class="absolute inset-0 flex flex-col items-center justify-center text-white/90 select-none pointer-events-none">
            <span class="text-4xl font-bold tracking-widest opacity-25">${esc(dest.name)}</span>
            <span class="text-xs tracking-widest opacity-60 mt-1">${esc(dest.province)} · ${esc(dest.region)}</span>
          </div>
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(dest.name)}" loading="lazy" class="dest-img relative z-10 w-full h-full object-cover" />` : ""}
          <div class="absolute inset-0 z-20 bg-gradient-to-t from-black/70 via-black/15 to-transparent pointer-events-none"></div>

          <!-- Top Badges & Actions -->
          <div class="absolute top-3 left-3 right-3 z-30 flex items-center justify-between gap-2">
            <span class="px-2.5 py-1 rounded-full text-[11px] font-semibold text-white shadow-sm" style="background:${regColor.bg}">
              ${esc(dest.region)} · ${esc(dest.province)}
            </span>
            <div class="flex items-center gap-1.5">
                <button type="button" class="btn-compare w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition ${isCmp ? "bg-[#C84B31] text-white" : "bg-black/40 text-white hover:bg-black/60"}" data-id="${esc(dest.id)}" aria-label="${isCmp ? "移出对比" : "加入对比"}" aria-pressed="${isCmp}">
                <i data-lucide="scale" class="w-4 h-4"></i>
              </button>
                <button type="button" class="btn-fav w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition ${isFav ? "bg-[#C84B31] text-white" : "bg-black/40 text-white hover:bg-black/60"}" data-id="${esc(dest.id)}" aria-label="${isFav ? "取消收藏" : "收藏到心愿单"}" aria-pressed="${isFav}">
                <i data-lucide="heart" class="w-4 h-4 ${isFav ? "fill-current" : ""}"></i>
              </button>
            </div>
          </div>

          <!-- Bottom Title & Attribution -->
          <div class="absolute bottom-2.5 left-3.5 right-3.5 z-30 flex items-end justify-between gap-2">
            <div>
              <h3 class="text-xl font-bold text-white leading-tight drop-shadow">${esc(dest.name)}</h3>
                ${imgUrl && img.credit ? `<div class="text-xs text-white/80 mt-0.5 truncate max-w-[230px]">
                图：${esc(img.credit || "Wikimedia")} ·
                  ${licenseUrl
                    ? `<a href="${esc(licenseUrl)}" target="_blank" rel="noopener noreferrer" class="underline hover:text-white">${esc(img.license || "CC")}</a>`
                  : esc(img.license || "CC")}
                </div>` : ""}
            </div>
            <span class="px-2.5 py-1 rounded-lg bg-white/95 text-[#1A1D21] text-xs font-semibold shrink-0 shadow-sm">
              ${esc(dest.days)}
            </span>
          </div>
        </div>

        <div class="p-4 flex-1 flex flex-col justify-between gap-3">
          <div class="space-y-2.5">
            <p class="text-sm text-[#1A1D21] font-medium leading-snug">${esc(dest.tagline)}</p>
            <div class="flex flex-wrap gap-1.5">
              ${(dest.tags || []).slice(0, 3).map(t => `<span class="px-2 py-0.5 rounded-md bg-[#FAF8F5] border border-[#E8E2D9] text-[11px] text-[#5C6370]">#${esc(t)}</span>`).join("")}
            </div>
          </div>

          <div class="pt-3 border-t border-[#F2EDE6] space-y-2">
            <div class="flex items-center justify-between gap-2 text-xs">
              <div class="flex items-center gap-1.5 min-w-0">
                ${seasonInfo
                  ? `<span class="px-1.5 py-0.5 rounded-md text-[11px] font-semibold shrink-0 ${seasonInfo.badgeClass}">${state.month}月${seasonInfo.label}</span>`
                  : `<span class="text-[#5C6370] shrink-0">参考预算</span>`}
                <span class="font-semibold text-[#1A1D21] truncate">${esc(displayBudget)}</span>
              </div>
              <span class="text-[#5C6370] shrink-0">${(dest.spots || []).length} 景点</span>
            </div>
            <div class="flex items-center justify-between text-[11px] text-[#8A919E]">
              <span class="truncate max-w-[70%]">${esc(dest.hotSource)}</span>
                <button type="button" class="text-[#A63A24] text-sm font-semibold shrink-0 hover:underline" aria-label="查看${esc(dest.name)}攻略">查看攻略</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderRegionTabs() {
    const counts = { "全部": appData.destinations.length };
    appData.destinations.forEach(d => {
      counts[d.region] = (counts[d.region] || 0) + 1;
    });

    const html = REGION_ORDER.filter(r => counts[r]).map(r => {
      const active = state.region === r;
      return `
        <button type="button" data-region="${esc(r)}" class="region-pill px-4 py-2 rounded-2xl text-sm font-medium shrink-0 transition border ${
          active
            ? "bg-[#1A1D21] text-white border-[#1A1D21] shadow-sm"
            : "bg-white text-[#1A1D21] border-[#E8E2D9] hover:border-[#C84B31]"
        }">
          ${esc(r)} <span class="ml-1 text-xs ${active ? "text-white/75" : "text-[#8A919E]"}">${counts[r]}</span>
        </button>
      `;
    }).join("");
    document.getElementById("regionTabs").innerHTML = html;

    const mapHtml = REGION_ORDER.filter(r => counts[r]).map(r => {
      const active = state.mapRegion === r;
      return `
        <button type="button" data-map-region="${esc(r)}" class="map-region-pill px-3.5 py-1.5 rounded-xl text-xs font-medium shrink-0 transition border ${
          active
            ? "bg-[#C84B31] text-white border-[#C84B31]"
            : "bg-white text-[#1A1D21] border-[#E8E2D9] hover:border-[#C84B31]"
        }">
          ${esc(r)} (${counts[r]})
        </button>
      `;
    }).join("");
    document.getElementById("mapRegionFilter").innerHTML = mapHtml;
  }

  function renderExplore() {
    const list = getFilteredDestinations();
    document.getElementById("resultCount").textContent = list.length;

    const hasFilter = state.region !== "全部" || state.search.trim() !== "" || state.days !== "all" || state.month !== 0 || state.budget !== 0 || state.sort !== "default";
    document.getElementById("resetFiltersBtn").classList.toggle("hidden", !hasFilter);
    document.getElementById("clearSearchBtn").classList.toggle("hidden", state.search.trim() === "");

    const grid = document.getElementById("destinationGrid");
    const empty = document.getElementById("exploreEmpty");
    if (!list.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      grid.innerHTML = list.map(renderCard).join("");
      attachImageFallbacks(grid);
    }
    lucide.createIcons();
  }

  function renderWishlist() {
    const favs = appData.destinations.filter(d => state.wishlist.includes(d.id));
    document.getElementById("wishlistBadgeDesktop").textContent = favs.length;
    document.getElementById("wishlistBadgeMobile").textContent = favs.length;
    document.getElementById("clearWishlistBtn").classList.toggle("hidden", favs.length === 0);

    const grid = document.getElementById("wishlistGrid");
    const empty = document.getElementById("wishlistEmpty");
    if (!favs.length) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      grid.innerHTML = favs.map(renderCard).join("");
      attachImageFallbacks(grid);
    }
    lucide.createIcons();
  }

  function attachImageFallbacks(root) {
    root.querySelectorAll("img.dest-img").forEach(img => {
      img.addEventListener("error", function () {
        this.style.display = "none";
      }, { once: true });
    });
  }

  function renderCompareBar() {
    const bar = document.getElementById("compareBar");
    if (!state.compareIds.length) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    const items = state.compareIds.map(id => appData.destinations.find(d => d.id === id)).filter(Boolean);
    document.getElementById("compareChips").innerHTML = items.map(d => `
      <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/10 text-xs font-medium shrink-0">
        ${esc(d.name)}
        <button type="button" class="remove-compare text-white/70 hover:text-white" data-id="${esc(d.id)}" aria-label="移除">×</button>
      </span>
    `).join("") + (items.length < 3 ? `<span class="text-[11px] text-white/50 shrink-0">还可加 ${3 - items.length} 城</span>` : "");
  }

  function writeLocation(view, city, replace = false) {
    const url = new URL(window.location.href);
    if (view === "explore") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    if (city) url.searchParams.set("city", city);
    else url.searchParams.delete("city");
    if (url.href !== window.location.href) history[replace ? "replaceState" : "pushState"](null, "", url.href);
  }

  function applyLocation() {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view");
    closeDetail(false);
    closeCompare();
    switchView(VIEWS.includes(view) ? view : "explore", false);
    const city = params.get("city");
    if (city) openDetail(city, false);
  }

  function openDetail(id, updateUrl = true) {
    const dest = appData.destinations.find(d => d.id === id);
    if (!dest) return;
    detailTrigger = document.activeElement;
    state.activeDestId = id;
    state.activeItinTab = "threeDays";
    renderDetailModal(dest);
    document.getElementById("detailModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    document.getElementById("detailModalBody").scrollTop = 0;
    document.getElementById("closeDetailBtn").focus();
    if (updateUrl) writeLocation(state.view, id);
  }

  function closeDetail(updateUrl = true) {
    if (!state.activeDestId) return;
    document.getElementById("detailModal").classList.add("hidden");
    document.body.style.overflow = "";
    state.activeDestId = null;
    if (detailTrigger?.isConnected) detailTrigger.focus();
    if (updateUrl) writeLocation(state.view, null, true);
  }

  function renderDetailModal(dest) {
    const isFav = state.wishlist.includes(dest.id);
    const isCmp = state.compareIds.includes(dest.id);
    const regColor = REGION_COLORS[dest.region] || { bg: "#5C6370", grad: "from-slate-700 to-slate-900" };
    const imgUrl = getImageUrl(dest);
    const img = dest.image || {};
    const licenseUrl = safeUrl(img.licenseUrl);
    const sourcePage = safeUrl(img.sourcePage);
    const sp = dest.seasonPrice || {};

    const monthStrip = Array.from({ length: 12 }, (_, idx) => {
      const m = idx + 1;
      const info = getSeasonForMonth(dest, m);
      const color = info
        ? (info.key === "peak" ? "bg-[#C84B31] text-white" : info.key === "shoulder" ? "bg-[#D97706] text-white" : "bg-[#2D6A4F] text-white")
        : "bg-[#EAE5DD] text-[#5C6370]";
      return `
        <div class="rounded-xl py-2 text-center ${color}">
          <div class="text-xs font-bold">${m}月</div>
          <div class="text-[10px] opacity-90">${info ? info.label : "-"}</div>
        </div>
      `;
    }).join("");

    const itinList = (dest.itineraries && dest.itineraries[state.activeItinTab]) || [];

    const html = `
      <div class="relative">
        <!-- Hero -->
        <div class="relative h-60 sm:h-72 bg-gradient-to-br ${regColor.grad} overflow-hidden">
          <div class="absolute inset-0 flex flex-col items-center justify-center text-white/25 select-none pointer-events-none">
            <span class="text-6xl font-bold tracking-widest">${esc(dest.name)}</span>
          </div>
          ${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(dest.name)}" class="dest-img relative z-10 w-full h-full object-cover" />` : ""}
          <div class="absolute inset-0 z-20 bg-gradient-to-t from-black/80 via-black/25 to-black/20"></div>

          <div class="absolute top-4 left-4 right-4 z-30 flex items-center justify-between">
            <span class="px-3 py-1 rounded-full text-xs font-semibold text-white" style="background:${regColor.bg}">
              ${esc(dest.region)} · ${esc(dest.province)}
            </span>
            <div class="flex items-center gap-2">
              <button type="button" id="detailFavBtn" class="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 backdrop-blur-md ${isFav ? "bg-[#C84B31] text-white" : "bg-black/45 text-white hover:bg-black/65"}">
                <i data-lucide="heart" class="w-3.5 h-3.5 ${isFav ? "fill-current" : ""}"></i>${isFav ? "已收藏" : "收藏"}
              </button>
              <button type="button" id="detailCmpBtn" class="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 backdrop-blur-md ${isCmp ? "bg-[#C84B31] text-white" : "bg-black/45 text-white hover:bg-black/65"}">
                <i data-lucide="scale" class="w-3.5 h-3.5"></i>${isCmp ? "已在对比" : "加入对比"}
              </button>
              <button type="button" id="closeDetailBtn" class="w-9 h-9 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-md" aria-label="关闭详情">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            </div>
          </div>

          <div class="absolute bottom-4 left-5 right-5 z-30 text-white">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/15 backdrop-blur-sm text-[11px] mb-2">
              <i data-lucide="award" class="w-3.5 h-3.5 text-amber-300"></i>
              上榜依据：${esc(dest.hotSource)}
            </div>
            <h2 id="detailTitle" class="text-2xl sm:text-3xl font-bold">${esc(dest.name)}</h2>
            <p class="text-sm text-white/85 mt-1">${esc(dest.tagline)}</p>
          </div>
        </div>

        <!-- Photo Attribution Bar (CC Compliance) -->
        ${imgUrl && img.credit ? `<div class="bg-[#F3EFE9] px-5 py-2 border-b border-[#E8E2D9] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C6370]">
          <div>
            配图作者：<strong class="text-[#1A1D21]">${esc(img.credit || "Wikimedia Contributors")}</strong> ·
            许可协议：${licenseUrl
              ? `<a href="${esc(licenseUrl)}" target="_blank" rel="noopener noreferrer" class="text-[#C84B31] underline">${esc(img.license || "CC")}</a>`
              : esc(img.license || "CC")}
          </div>
          ${sourcePage
            ? `<a href="${esc(sourcePage)}" target="_blank" rel="noopener noreferrer" class="text-[#1A1D21] hover:text-[#C84B31] underline">查看图片原始出处</a>`
            : ""}
        </div>` : ""}

        <!-- Body -->
        <div class="p-5 sm:p-6 space-y-6">
          <!-- 4 Core Info Cards -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="bg-white rounded-2xl border border-[#E8E2D9] p-3.5">
              <div class="text-xs text-[#5C6370] flex items-center gap-1.5 mb-1"><i data-lucide="sun" class="w-3.5 h-3.5 text-[#D97706]"></i>最佳季节</div>
              <div class="text-sm font-semibold text-[#1A1D21]">${esc(dest.bestSeason)}</div>
            </div>
            <div class="bg-white rounded-2xl border border-[#E8E2D9] p-3.5">
              <div class="text-xs text-[#5C6370] flex items-center gap-1.5 mb-1"><i data-lucide="calendar" class="w-3.5 h-3.5 text-[#C84B31]"></i>建议天数</div>
              <div class="text-sm font-semibold text-[#1A1D21]">${esc(dest.days)}</div>
            </div>
            <div class="bg-white rounded-2xl border border-[#E8E2D9] p-3.5">
              <div class="text-xs text-[#5C6370] flex items-center gap-1.5 mb-1"><i data-lucide="wallet" class="w-3.5 h-3.5 text-[#2D6A4F]"></i>人均预算（估算）</div>
              <div class="text-sm font-semibold text-[#1A1D21]">${esc(dest.budget)}</div>
            </div>
            <div class="bg-white rounded-2xl border border-[#E8E2D9] p-3.5">
              <div class="text-xs text-[#5C6370] flex items-center gap-1.5 mb-1"><i data-lucide="train-front" class="w-3.5 h-3.5 text-[#0369A1]"></i>大交通</div>
              <div class="text-sm font-semibold text-[#1A1D21]">${esc(dest.transport)}</div>
            </div>
          </div>

          <!-- Season Price Calendar -->
          <div class="bg-white rounded-3xl border border-[#E8E2D9] p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-base flex items-center gap-2">
                <i data-lucide="trending-up" class="w-4 h-4 text-[#C84B31]"></i>淡旺季月份与预算参考
              </h3>
              <span class="text-[11px] text-[#8A919E]">${esc(sp.basis || "展示用估算，非实时报价")}</span>
            </div>
            <div class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-1.5">${monthStrip}</div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div class="rounded-2xl bg-[#C84B31]/5 border border-[#C84B31]/20 p-3">
                <div class="font-bold text-[#C84B31]">旺季 · ${esc((sp.peak && sp.peak.range) || "-")}</div>
                <p class="text-[#5C6370] mt-1">${esc((sp.peak && sp.peak.note) || "")}</p>
              </div>
              <div class="rounded-2xl bg-[#D97706]/5 border border-[#D97706]/20 p-3">
                <div class="font-bold text-[#B45309]">平季 · ${esc((sp.shoulder && sp.shoulder.range) || "-")}</div>
                <p class="text-[#5C6370] mt-1">${esc((sp.shoulder && sp.shoulder.note) || "")}</p>
              </div>
              <div class="rounded-2xl bg-[#2D6A4F]/5 border border-[#2D6A4F]/20 p-3">
                <div class="font-bold text-[#2D6A4F]">淡季 · ${esc((sp.off && sp.off.range) || "-")}</div>
                <p class="text-[#5C6370] mt-1">${esc((sp.off && sp.off.note) || "")}</p>
              </div>
            </div>
          </div>

          <!-- Spots List -->
          <div class="bg-white rounded-3xl border border-[#E8E2D9] p-5 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="font-bold text-base flex items-center gap-2">
                <i data-lucide="landmark" class="w-4 h-4 text-[#C84B31]"></i>必去景点（${(dest.spots || []).length} 个）
              </h3>
              <div class="flex flex-wrap gap-3">
                ${dest.coords ? `<button type="button" id="detailLocateCityBtn" class="text-sm font-medium text-[#A63A24] hover:underline flex items-center gap-1"><i data-lucide="map-pin" class="w-3.5 h-3.5"></i>在地图上查看</button>` : ""}
                <button type="button" id="shareCityBtn" class="text-sm font-medium text-[#A63A24] hover:underline flex items-center gap-1"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>复制攻略链接</button>
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              ${(dest.spots || []).map((s, idx) => `
                <div class="rounded-2xl bg-[#FAF8F5] border border-[#E8E2D9] p-3.5 flex flex-col justify-between gap-2">
                  <div>
                    <div class="flex items-start justify-between gap-2">
                      <div class="font-semibold text-sm text-[#1A1D21]">${idx + 1}. ${esc(s.name)}</div>
                      <span class="px-2 py-0.5 rounded-md bg-white border border-[#E8E2D9] text-[11px] text-[#5C6370] shrink-0">${esc(s.ticket || "详见官方")}</span>
                    </div>
                    ${s.tip ? `<p class="text-xs text-[#5C6370] mt-1.5 leading-relaxed">💡 ${esc(s.tip)}</p>` : ""}
                  </div>
                  ${s.coords ? `
                    <div class="flex items-center justify-between pt-2 border-t border-[#EAE5DD] text-[11px] text-[#8A919E]">
                      <span>GCJ-02: ${s.coords.lat.toFixed(4)}, ${s.coords.lng.toFixed(4)}</span>
                      <button type="button" class="locate-spot-btn text-[#C84B31] font-medium hover:underline" data-dest="${esc(dest.id)}" data-spot-idx="${idx}">地图定位</button>
                    </div>
                  ` : ""}
                </div>
              `).join("")}
            </div>
          </div>

          <!-- 3-Day / 5-Day Itineraries -->
          <div class="bg-white rounded-3xl border border-[#E8E2D9] p-5 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-base flex items-center gap-2">
                  <i data-lucide="route" class="w-4 h-4 text-[#C84B31]"></i>分日行程推荐
                </h3>
                <div class="inline-flex bg-[#FAF8F5] p-1 rounded-xl border border-[#E8E2D9]">
                  <button type="button" data-itin="threeDays" class="itin-tab px-3 py-1 rounded-lg text-xs font-semibold transition ${state.activeItinTab === "threeDays" ? "bg-[#1A1D21] text-white" : "text-[#5C6370]"}">3 天精华版</button>
                  <button type="button" data-itin="fiveDays" class="itin-tab px-3 py-1 rounded-lg text-xs font-semibold transition ${state.activeItinTab === "fiveDays" ? "bg-[#1A1D21] text-white" : "text-[#5C6370]"}">5 天深度版</button>
                </div>
              </div>
              <button type="button" id="copyItinBtn" class="px-3 py-1.5 rounded-xl bg-[#FAF8F5] border border-[#E8E2D9] hover:border-[#C84B31] text-xs font-medium text-[#1A1D21] flex items-center gap-1.5">
                <i data-lucide="copy" class="w-3.5 h-3.5"></i>复制行程文本
              </button>
            </div>

            <div class="space-y-3">
              ${itinList.map(day => `
                <div class="rounded-2xl border border-[#E8E2D9] overflow-hidden">
                  <div class="bg-[#FAF8F5] px-4 py-2.5 border-b border-[#E8E2D9] flex items-center justify-between">
                    <span class="font-bold text-sm text-[#1A1D21]">Day ${day.day} · ${esc(day.title)}</span>
                  </div>
                  <div class="p-4 space-y-2.5">
                    ${(day.items || []).map(item => `
                      <div class="flex items-start gap-3 text-sm">
                        <span class="px-2 py-0.5 rounded-md bg-[#C84B31]/10 text-[#C84B31] text-xs font-semibold shrink-0 mt-0.5">${esc(item.time)}</span>
                        <div class="flex-1 min-w-0">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="font-semibold text-[#1A1D21]">${esc(item.name)}</span>
                            ${item.ticket ? `<span class="text-[11px] px-1.5 py-0.5 rounded bg-[#FAF8F5] border border-[#E8E2D9] text-[#5C6370]">${esc(item.ticket)}</span>` : ""}
                          </div>
                          <p class="text-xs text-[#5C6370] mt-0.5">${esc(item.action)}</p>
                          ${item.tip ? `<p class="text-[11px] text-[#B45309] mt-0.5">提示：${esc(item.tip)}</p>` : ""}
                        </div>
                      </div>
                    `).join("")}
                    ${(day.notes && day.notes.length) ? `
                      <div class="mt-2 pt-2 border-t border-dashed border-[#E8E2D9] text-[11px] text-[#5C6370]">
                        <span class="font-semibold text-[#1A1D21]">当日注意：</span>${day.notes.map(esc).join("；")}
                      </div>
                    ` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>

          <!-- Food & Pitfall Tips -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-white rounded-3xl border border-[#E8E2D9] p-5">
              <h3 class="font-bold text-base flex items-center gap-2 mb-3">
                <i data-lucide="utensils" class="w-4 h-4 text-[#D97706]"></i>必吃地道美食
              </h3>
              <div class="flex flex-wrap gap-2">
                ${(dest.food || []).map(f => `<span class="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200/70 text-sm font-medium text-amber-900">${esc(f)}</span>`).join("")}
              </div>
            </div>
            <div class="bg-white rounded-3xl border border-[#E8E2D9] p-5">
              <h3 class="font-bold text-base flex items-center gap-2 mb-3">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-[#C84B31]"></i>避坑与实用提示
              </h3>
              <ul class="space-y-2 text-sm text-[#5C6370]">
                ${(dest.tips || []).map(t => `<li class="flex items-start gap-2"><span class="text-[#C84B31] font-bold">•</span><span>${esc(t)}</span></li>`).join("")}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;

    const body = document.getElementById("detailModalBody");
    body.innerHTML = html;
    attachImageFallbacks(body);
    lucide.createIcons();

    document.getElementById("closeDetailBtn").addEventListener("click", () => closeDetail());
    document.getElementById("shareCityBtn").addEventListener("click", async () => {
      const url = new URL(window.location.pathname, window.location.origin);
      url.searchParams.set("city", dest.id);
      showToast(await copyToClipboard(url.href) ? "城市攻略链接已复制" : "可从地址栏复制城市攻略链接");
    });
    document.getElementById("detailFavBtn").addEventListener("click", () => {
      toggleWishlist(dest.id);
      renderDetailModal(dest);
    });
    document.getElementById("detailCmpBtn").addEventListener("click", () => {
      toggleCompare(dest.id);
      renderDetailModal(dest);
    });
    document.getElementById("detailLocateCityBtn")?.addEventListener("click", () => {
      closeDetail();
      switchView("map");
      focusCityOnMap(dest.id);
    });
    body.querySelectorAll(".locate-spot-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const did = btn.dataset.dest;
        const sIdx = Number(btn.dataset.spotIdx);
        closeDetail();
        switchView("map");
        focusCityOnMap(did, sIdx);
      });
    });
    body.querySelectorAll(".itin-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        state.activeItinTab = btn.dataset.itin;
        renderDetailModal(dest);
      });
    });
    document.getElementById("copyItinBtn").addEventListener("click", async () => {
      const days = (dest.itineraries && dest.itineraries[state.activeItinTab]) || [];
      const label = state.activeItinTab === "threeDays" ? "3天精华行程" : "5天深度行程";
      const text = `【${dest.name} · ${label}】\n` + days.map(d =>
        `\nDay ${d.day}：${d.title}\n` + (d.items || []).map(i => `- [${i.time}] ${i.name}：${i.action}${i.ticket ? `（门票：${i.ticket}）` : ""}`).join("\n")
      ).join("\n");
      showToast(await copyToClipboard(text) ? `已复制${dest.name}${label}` : "复制失败，可以选中行程文字手动复制");
    });
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { return document.execCommand("copy"); } catch { return false; }
    finally { ta.remove(); }
  }

  function toggleWishlist(id) {
    const idx = state.wishlist.indexOf(id);
    if (idx >= 0) {
      state.wishlist.splice(idx, 1);
      showToast("已从心愿单移除");
    } else {
      state.wishlist.push(id);
      showToast("已加入旅行心愿单");
    }
    saveKey("china_travel_wishlist", state.wishlist);
    renderExplore();
    renderWishlist();
  }

  function toggleCompare(id) {
    const idx = state.compareIds.indexOf(id);
    if (idx >= 0) {
      state.compareIds.splice(idx, 1);
    } else {
      if (state.compareIds.length >= 3) {
        showToast("最多同时对比 3 个目的地");
        return;
      }
      state.compareIds.push(id);
    }
    renderCompareBar();
    renderExplore();
    renderWishlist();
  }

  function openCompareModal() {
    const items = state.compareIds.map(id => appData.destinations.find(d => d.id === id)).filter(Boolean);
    if (items.length < 2) {
      showToast("请至少选择 2 个目的地进行对比");
      return;
    }
    const rows = [
      { label: "所属大区 / 省份", fn: d => `${d.region} · ${d.province}` },
      { label: "一句话亮点", fn: d => d.tagline },
      { label: "上榜依据", fn: d => d.hotSource },
      { label: "最佳季节", fn: d => d.bestSeason },
      { label: "建议天数", fn: d => d.days },
      { label: "常规预算（估算）", fn: d => d.budget },
      { label: "旺季预算 / 月份", fn: d => d.seasonPrice && d.seasonPrice.peak ? `${d.seasonPrice.peak.range}（${d.seasonPrice.peak.months.join(",")}月）` : "-" },
      { label: "淡季预算 / 月份", fn: d => d.seasonPrice && d.seasonPrice.off ? `${d.seasonPrice.off.range}（${d.seasonPrice.off.months.join(",")}月）` : "-" },
      { label: "大交通", fn: d => d.transport },
      { label: "核心景点", fn: d => (d.spots || []).map(s => s.name).join("、") },
      { label: "必吃美食", fn: d => (d.food || []).join("、") },
      { label: "避坑提示", fn: d => (d.tips || []).join("；") }
    ];

    const html = `
      <table class="w-full text-sm border-collapse min-w-[540px]">
        <thead>
          <tr class="border-b-2 border-[#E8E2D9]">
            <th class="py-3 px-3 text-left text-xs text-[#5C6370] w-36 bg-[#FAF8F5]">对比维度</th>
            ${items.map(d => `
              <th class="py-3 px-4 text-left bg-[#FAF8F5]">
                <div class="font-bold text-base text-[#1A1D21]">${esc(d.name)}</div>
                <button type="button" class="cmp-open-detail text-sm text-[#A63A24] font-medium hover:underline mt-0.5" data-id="${esc(d.id)}">查看完整攻略</button>
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody class="divide-y divide-[#F2EDE6]">
          ${rows.map(r => `
            <tr>
              <td class="py-3 px-3 font-medium text-xs text-[#5C6370] align-top bg-[#FAF8F5]/50">${esc(r.label)}</td>
              ${items.map(d => `<td class="py-3 px-4 text-[#1A1D21] align-top leading-relaxed">${esc(r.fn(d))}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    const body = document.getElementById("compareModalBody");
    body.innerHTML = html;
    body.querySelectorAll(".cmp-open-detail").forEach(btn => {
      btn.addEventListener("click", () => {
        closeCompare();
        openDetail(btn.dataset.id);
      });
    });
    compareTrigger = document.activeElement;
    document.getElementById("compareModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    document.getElementById("closeCompareModalBtn").focus();
  }

  function closeCompare() {
    const modal = document.getElementById("compareModal");
    if (modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    if (compareTrigger?.isConnected) compareTrigger.focus();
  }

  // ---------- MAP VIEW (Leaflet + Gaode GCJ-02 Tiles) ----------
  function initMap() {
    if (mapInstance) {
      setTimeout(() => mapInstance.invalidateSize(), 60);
      return;
    }
    mapInstance = L.map("chinaMap", {
      center: [34.5, 107.5],
      zoom: 4,
      minZoom: 3,
      maxZoom: 17
    });
    cityMarkersLayer = L.layerGroup().addTo(mapInstance);
    spotMarkersLayer = L.layerGroup().addTo(mapInstance);
    setMapTileStyle("std");
  }

  function mapCoordinates(point) {
    const original = point.wgs84;
    if (state.mapStyle === "osm" && Number.isFinite(original?.lat) && Number.isFinite(original?.lon)) return [original.lat, original.lon];
    return [point.lat, point.lng];
  }

  function setMapTileStyle(style, explanation = "") {
    state.mapStyle = style;
    if (!mapInstance) return;
    if (mapTileLayer) mapInstance.removeLayer(mapTileLayer);
    const tiles = {
      std: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
      sat: "https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
      osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    };
    const status = document.getElementById("mapStatus");
    status.textContent = explanation;
    status.classList.toggle("hidden", !explanation);
    const layer = L.tileLayer(tiles[style], {
      subdomains: ["1", "2", "3", "4"],
      attribution: style === "osm" ? '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' : "地图底图 © 高德地图"
    });
    mapTileLayer = layer;
    let tileLoads = 0;
    let tileErrors = 0;
    layer.on("tileload", () => { tileLoads++; });
    layer.on("tileerror", () => {
      if (layer !== mapTileLayer || tileLoads || ++tileErrors !== 3) return;
      if (style === "sat") setMapTileStyle("std", "卫星图暂时无法加载，已切回标准图。");
      else if (style === "std") setMapTileStyle("osm", "高德底图暂时无法加载，已切换到备用地图。");
      else {
        status.textContent = "底图暂时无法加载，可以继续使用城市列表和景点标记。";
        status.classList.remove("hidden");
      }
    });
    layer.addTo(mapInstance);

    document.getElementById("mapTileStdBtn").className = style === "std"
      ? "px-3 py-1.5 rounded-xl text-xs font-medium bg-[#1A1D21] text-white transition"
      : "px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-[#E8E2D9] text-[#1A1D21] transition";
    document.getElementById("mapTileSatBtn").className = style === "sat"
      ? "px-3 py-1.5 rounded-xl text-xs font-medium bg-[#1A1D21] text-white transition"
      : "px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-[#E8E2D9] text-[#1A1D21] transition";
    document.getElementById("mapTileStdBtn").setAttribute("aria-pressed", String(style === "std"));
    document.getElementById("mapTileSatBtn").setAttribute("aria-pressed", String(style === "sat"));
    renderMapMarkers();
    if (state.mapFocusedId) focusCityOnMap(state.mapFocusedId);
  }

  function renderMapMarkers() {
    if (!mapInstance) return;
    cityMarkersLayer.clearLayers();
    spotMarkersLayer.clearLayers();

    const list = appData.destinations.filter(d => state.mapRegion === "全部" || d.region === state.mapRegion);

    list.forEach(d => {
      if (!d.coords) return;
      const color = (REGION_COLORS[d.region] && REGION_COLORS[d.region].bg) || "#C84B31";
      const icon = L.divIcon({
        className: "",
        html: `<div class="custom-pin" style="background:${color}">${esc(d.name)}</div>`,
        iconSize: [58, 26],
        iconAnchor: [29, 13]
      });
      const marker = L.marker(mapCoordinates(d.coords), { icon, title: d.name, alt: d.name }).addTo(cityMarkersLayer);
      marker.on("click", () => focusCityOnMap(d.id));
    });

    renderMapSideList(list);
  }

  function renderMapSideList(list) {
    const titleEl = document.getElementById("mapSideTitle");
    const clearBtn = document.getElementById("mapClearFocusBtn");
    const listEl = document.getElementById("mapSideList");

    if (state.mapFocusedId) {
      const dest = appData.destinations.find(d => d.id === state.mapFocusedId);
      if (dest) {
        titleEl.textContent = `${dest.name} · ${(dest.spots || []).length} 个景点`;
        clearBtn.classList.remove("hidden");
        listEl.innerHTML = `
          <div class="py-3 flex items-center justify-between gap-2">
            <div class="text-xs text-[#5C6370]">${esc(dest.tagline)}</div>
            <button type="button" id="mapSideOpenDetail" class="px-2.5 py-1 rounded-lg bg-[#C84B31] text-white text-xs font-medium shrink-0">看攻略</button>
          </div>
          ${(dest.spots || []).map((s, idx) => `
            <button type="button" class="map-spot-row w-full text-left py-2.5 px-2 hover:bg-[#FAF8F5] rounded-xl transition flex items-start gap-2.5" data-idx="${idx}">
              <span class="w-5 h-5 rounded-full bg-[#1A1D21] text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-[#1A1D21]">${esc(s.name)}</div>
                <div class="text-xs text-[#5C6370]">${esc(s.ticket || "")}${s.tip ? " · " + esc(s.tip) : ""}</div>
              </div>
            </button>
          `).join("")}
        `;
        document.getElementById("mapSideOpenDetail").addEventListener("click", () => openDetail(dest.id));
        listEl.querySelectorAll(".map-spot-row").forEach(row => {
          row.addEventListener("click", () => focusCityOnMap(dest.id, Number(row.dataset.idx)));
        });
        return;
      }
    }

    clearBtn.classList.add("hidden");
    titleEl.textContent = `${state.mapRegion === "全部" ? "全部" : state.mapRegion} ${list.length} 个目的地`;
    listEl.innerHTML = list.map(d => `
      <button type="button" class="map-city-row w-full text-left py-2.5 px-2 hover:bg-[#FAF8F5] rounded-xl transition flex items-center justify-between gap-2" data-id="${esc(d.id)}">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-[#1A1D21]">${esc(d.name)} <span class="text-xs font-normal text-[#8A919E]">${esc(d.province)}</span></div>
          <div class="text-xs text-[#5C6370] truncate">${esc(d.days)} · ${(d.spots || []).length} 个景点</div>
        </div>
          <span class="text-xs text-[#A63A24] font-medium shrink-0">定位</span>
      </button>
    `).join("");

    listEl.querySelectorAll(".map-city-row").forEach(row => {
      row.addEventListener("click", () => focusCityOnMap(row.dataset.id));
    });
  }

  function focusCityOnMap(destId, spotIndex = null) {
    initMap();
    const dest = appData.destinations.find(d => d.id === destId);
    if (!dest || !dest.coords) return;
    state.mapFocusedId = destId;
    spotMarkersLayer.clearLayers();

    const center = mapCoordinates(dest.coords);
    const bounds = [center];
    let targetSpotMarker = null;

    (dest.spots || []).forEach((s, idx) => {
      if (!s.coords) return;
      const point = mapCoordinates(s.coords);
      bounds.push(point);
      const icon = L.divIcon({
        className: "",
        html: `<div class="spot-pin">${idx + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      const m = L.marker(point, { icon, title: s.name, alt: s.name }).addTo(spotMarkersLayer);
      m.bindPopup(`
        <div style="min-width:160px">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">${idx + 1}. ${esc(s.name)}</div>
          <div style="font-size:12px;color:#5C6370">门票：${esc(s.ticket || "详见官方")}</div>
          ${s.tip ? `<div style="font-size:11px;color:#B45309;margin-top:3px">${esc(s.tip)}</div>` : ""}
        </div>
      `);
      if (spotIndex === idx) targetSpotMarker = m;
    });

    if (targetSpotMarker) {
      const sc = dest.spots[spotIndex].coords;
      mapInstance.setView(mapCoordinates(sc), 13, { animate: true });
      targetSpotMarker.openPopup();
    } else if (bounds.length > 1) {
      mapInstance.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    } else {
      mapInstance.setView(center, 11, { animate: true });
    }

    const list = appData.destinations.filter(d => state.mapRegion === "全部" || d.region === state.mapRegion);
    renderMapSideList(list);
  }

  // ---------- INSIGHTS VIEW (Chart.js) ----------
  function renderInsights() {
    const regions = REGION_ORDER.filter(r => r !== "全部");
    const cityCounts = regions.map(r => appData.destinations.filter(d => d.region === r).length);
    const spotCounts = regions.map(r => appData.destinations.filter(d => d.region === r).reduce((acc, d) => acc + (d.spots || []).length, 0));

    if (regionChartInst) regionChartInst.destroy();
    regionChartInst = new Chart(document.getElementById("regionChart"), {
      type: "bar",
      data: {
        labels: regions,
        datasets: [
          { label: "目的地数量", data: cityCounts, backgroundColor: "#C84B31", borderRadius: 6 },
          { label: "精选景点数量", data: spotCounts, backgroundColor: "#2D6A4F", borderRadius: 6 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } }
      }
    });

    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const peakArr = months.map(m => appData.destinations.filter(d => { const s = getSeasonForMonth(d, m); return s && s.key === "peak"; }).length);
    const shArr = months.map(m => appData.destinations.filter(d => { const s = getSeasonForMonth(d, m); return s && s.key === "shoulder"; }).length);
    const offArr = months.map(m => appData.destinations.filter(d => { const s = getSeasonForMonth(d, m); return s && s.key === "off"; }).length);

    if (seasonChartInst) seasonChartInst.destroy();
    seasonChartInst = new Chart(document.getElementById("seasonChart"), {
      type: "bar",
      data: {
        labels: months.map(m => m + "月"),
        datasets: [
          { label: "淡季（性价比高）", data: offArr, backgroundColor: "#2D6A4F", borderRadius: 4 },
          { label: "平季（错峰推荐）", data: shArr, backgroundColor: "#D97706", borderRadius: 4 },
          { label: "旺季（人多溢价）", data: peakArr, backgroundColor: "#C84B31", borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true }
        }
      }
    });

    const meta = appData.meta || {};
    document.getElementById("metaSourcesList").innerHTML = (meta.sources || []).map(s =>
      `<li class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-[#C84B31]"></span><span>${esc(s)}</span></li>`
    ).join("");
    document.getElementById("metaCoordSys").textContent = meta.coordinateSystem || "GCJ-02";
    document.getElementById("metaImgNote").textContent = meta.imageNote || "维基共享资源自由许可";
  }

  // ---------- NAVIGATION ----------
  function switchView(view, updateUrl = true) {
    state.view = view;
    VIEWS.forEach(v => {
      document.getElementById("view-" + v).classList.toggle("hidden", v !== view);
    });
    document.querySelectorAll(".nav-tab").forEach(btn => {
      const active = btn.dataset.view === view;
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
      btn.className = `nav-tab px-3.5 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${
        active ? "bg-[#1A1D21] text-white shadow-sm" : "text-[#5C6370] hover:text-[#1A1D21]"
      }`;
    });
    document.querySelectorAll(".nav-tab-mobile").forEach(btn => {
      const active = btn.dataset.view === view;
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
      btn.className = `nav-tab-mobile px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${
        active ? "bg-[#1A1D21] text-white" : "bg-[#FAF8F5] text-[#1A1D21]"
      }`;
    });
    document.getElementById("mobileNav").classList.add("hidden");
    document.getElementById("mobileMenuBtn").setAttribute("aria-expanded", "false");
    if (updateUrl) writeLocation(view, state.activeDestId);

    if (view === "map") {
      initMap();
    } else if (view === "insights") {
      renderInsights();
    } else if (view === "wishlist") {
      renderWishlist();
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function refreshStats() {
    const dests = appData.destinations || [];
    document.getElementById("statDestinations").textContent = dests.length;
    document.getElementById("statSpots").textContent = dests.reduce((a, d) => a + (d.spots || []).length, 0);
    document.getElementById("statFoods").textContent = dests.reduce((a, d) => a + (d.food || []).length, 0);
  }

  function applyDataset(data, isImported) {
    appData = data;
    imported = isImported;
    document.getElementById("resetDataBtn").classList.toggle("hidden", !imported);
    state.region = "全部";
    state.mapRegion = "全部";
    state.mapFocusedId = null;
    state.compareIds = state.compareIds.filter(id => data.destinations.some(city => city.id === id));
    refreshStats();
    renderRegionTabs();
    renderExplore();
    renderWishlist();
    renderCompareBar();
    if (mapInstance) renderMapMarkers();
    if (state.view === "insights") renderInsights();
  }

  // ---------- EVENT BINDING ----------
  function bindEvents() {
    document.getElementById("brandBtn").addEventListener("click", () => switchView("explore"));
    document.getElementById("mobileMenuBtn").addEventListener("click", () => {
      const hidden = document.getElementById("mobileNav").classList.toggle("hidden");
      document.getElementById("mobileMenuBtn").setAttribute("aria-expanded", String(!hidden));
    });
    document.querySelectorAll(".nav-tab, .nav-tab-mobile").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    window.addEventListener("popstate", applyLocation);

    // Search & Filters
    document.getElementById("searchInput").addEventListener("input", e => {
      state.search = e.target.value;
      renderExplore();
    });
    document.getElementById("clearSearchBtn").addEventListener("click", () => {
      state.search = "";
      document.getElementById("searchInput").value = "";
      renderExplore();
    });
    document.getElementById("daysFilter").addEventListener("change", e => {
      state.days = e.target.value;
      renderExplore();
    });
    document.getElementById("monthFilter").addEventListener("change", e => {
      state.month = Number(e.target.value);
      renderExplore();
    });
    document.getElementById("budgetFilter").addEventListener("change", e => {
      state.budget = Number(e.target.value);
      renderExplore();
    });
    document.getElementById("sortSelect").addEventListener("change", e => {
      state.sort = e.target.value;
      renderExplore();
    });

    function resetAllFilters() {
      state.region = "全部";
      state.search = "";
      state.days = "all";
      state.month = 0;
      state.budget = 0;
      state.sort = "default";
      document.getElementById("searchInput").value = "";
      document.getElementById("daysFilter").value = "all";
      document.getElementById("monthFilter").value = "0";
      document.getElementById("budgetFilter").value = "0";
      document.getElementById("sortSelect").value = "default";
      renderRegionTabs();
      renderExplore();
    }
    document.getElementById("resetFiltersBtn").addEventListener("click", resetAllFilters);
    document.getElementById("emptyResetBtn").addEventListener("click", resetAllFilters);

    document.getElementById("quickRandomBtn").addEventListener("click", () => {
      const pool = getFilteredDestinations();
      const list = pool.length ? pool : appData.destinations;
      const pick = list[Math.floor(Math.random() * list.length)];
      if (pick) openDetail(pick.id);
    });

    // Region pills delegation
    document.getElementById("regionTabs").addEventListener("click", e => {
      const btn = e.target.closest(".region-pill");
      if (!btn) return;
      state.region = btn.dataset.region;
      renderRegionTabs();
      renderExplore();
    });

    document.getElementById("mapRegionFilter").addEventListener("click", e => {
      const btn = e.target.closest(".map-region-pill");
      if (!btn) return;
      state.mapRegion = btn.dataset.mapRegion;
      state.mapFocusedId = null;
      renderRegionTabs();
      renderMapMarkers();
    });

    // Card clicks (Explore + Wishlist delegation)
    ["destinationGrid", "wishlistGrid"].forEach(gridId => {
      document.getElementById(gridId).addEventListener("click", e => {
        if (e.target.closest("a")) return;
        const favBtn = e.target.closest(".btn-fav");
        if (favBtn) {
          e.stopPropagation();
          toggleWishlist(favBtn.dataset.id);
          return;
        }
        const cmpBtn = e.target.closest(".btn-compare");
        if (cmpBtn) {
          e.stopPropagation();
          toggleCompare(cmpBtn.dataset.id);
          return;
        }
        const card = e.target.closest(".dest-card");
        if (card) openDetail(card.dataset.id);
      });
    });

    // Wishlist controls
    document.getElementById("goExploreBtn").addEventListener("click", () => switchView("explore"));
    document.getElementById("clearWishlistBtn").addEventListener("click", () => {
      state.wishlist = [];
      saveKey("china_travel_wishlist", []);
      renderWishlist();
      renderExplore();
      showToast("已清空心愿单");
    });

    // Compare controls
    document.getElementById("compareChips").addEventListener("click", e => {
      const rm = e.target.closest(".remove-compare");
      if (rm) toggleCompare(rm.dataset.id);
    });
    document.getElementById("clearCompareBtn").addEventListener("click", () => {
      state.compareIds = [];
      renderCompareBar();
      renderExplore();
      renderWishlist();
    });
    document.getElementById("openCompareBtn").addEventListener("click", openCompareModal);
    document.getElementById("closeCompareModalBtn").addEventListener("click", closeCompare);

    // Backdrop & Escape closes modals
    document.getElementById("detailModal").addEventListener("click", e => {
      if (e.target === e.currentTarget) closeDetail();
    });
    document.getElementById("compareModal").addEventListener("click", e => {
      if (e.target === e.currentTarget) closeCompare();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeDetail();
        closeCompare();
      }
      if (e.key === "Tab") {
        const modal = document.querySelector('[role="dialog"]:not(.hidden)');
        if (!modal) return;
        const items = [...modal.querySelectorAll('button:not([disabled]), a[href]')];
        const first = items[0], last = items.at(-1);
        if (!first) return;
        const focused = document.activeElement;
        if (!modal.contains(focused) || (e.shiftKey ? focused === first : focused === last)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    });

    // Map controls
    document.getElementById("mapTileStdBtn").addEventListener("click", () => setMapTileStyle("std"));
    document.getElementById("mapTileSatBtn").addEventListener("click", () => setMapTileStyle("sat"));
    document.getElementById("mapResetBtn").addEventListener("click", () => {
      state.mapFocusedId = null;
      if (mapInstance) {
        spotMarkersLayer.clearLayers();
        mapInstance.setView([34.5, 107.5], 4, { animate: true });
        renderMapMarkers();
      }
    });
    document.getElementById("mapClearFocusBtn").addEventListener("click", () => {
      state.mapFocusedId = null;
      if (mapInstance) {
        spotMarkersLayer.clearLayers();
        mapInstance.setView([34.5, 107.5], 4, { animate: true });
        renderMapMarkers();
      }
    });

    // Hot-import JSON
    const input = document.getElementById("jsonImportInput");
    document.getElementById("importDataBtn").addEventListener("click", () => input.click());
    document.getElementById("resetDataBtn").addEventListener("click", () => {
      try { localStorage.removeItem(DATA_KEY); } catch {}
      applyDataset(defaultData, false);
      showToast("已恢复原始城市数据");
    });
    input.addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      e.target.value = "";
      if (file.size > 3 * 1024 * 1024) {
        showToast("请选择 3 MB 以内的城市数据文件");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!validateData(parsed)) throw new Error("请检查城市资料的字段和格式");
          const saved = saveKey(DATA_KEY, parsed);
          applyDataset(parsed, true);
          showToast(`已导入 ${parsed.destinations.length} 个目的地${saved ? "，保存在当前浏览器" : "，仅供本次浏览"}`);
        } catch {
          showToast("导入失败，请参考原始城市数据的 JSON 格式");
        }
      };
      reader.onerror = () => showToast("文件读取失败，请重新选择");
      reader.readAsText(file, "utf-8");
    });
  }

  // ---------- INIT ----------
  async function init() {
    const status = document.getElementById("dataStatus");
    try {
      const response = await fetch("destinations.json");
      if (!response.ok) throw new Error("Data unavailable");
      defaultData = await response.json();
      if (!validateData(defaultData)) throw new Error("Invalid dataset");
      const local = loadSaved(DATA_KEY, null);
      const useLocal = validateData(local);
      applyDataset(useLocal ? local : defaultData, useLocal);
      bindEvents();
      applyLocation();
      status.classList.add("hidden");
      lucide.createIcons();
    } catch (error) {
      console.error(error);
      status.textContent = "旅行数据暂时无法加载。";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ml-3 underline text-[#A63A24]";
      retry.textContent = "重新加载";
      retry.addEventListener("click", () => window.location.reload());
      status.append(retry);
    }
  }
  init();
})();
