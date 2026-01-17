// Summary: added agent observation/action handlers while preserving guide and flow utilities.
(() => {
  const GUIDE_ID = "__hacktide_guide_root__";
  const STYLE_ID = "__hacktide_guide_style__";

  // You can change these anytime:
  const ARROW_COLOR = "#00ff6a";
  const ARROW_THICKNESS = 10; // px

  const ARROW_HEAD_LEN = Math.max(18, Math.round(ARROW_THICKNESS * 2.2));
  const ARROW_HEAD_HALF = Math.max(10, Math.round(ARROW_THICKNESS * 1.2));

  const state = {
    target: null,
    ui: null,
    running: false,
    flowCancel: false,
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function rectOverlapArea(a, b) {
    const x1 = Math.max(a.left, b.left);
    const y1 = Math.max(a.top, b.top);
    const x2 = Math.min(a.right, b.right);
    const y2 = Math.min(a.bottom, b.bottom);
    const w = Math.max(0, x2 - x1);
    const h = Math.max(0, y2 - y1);
    return w * h;
  }

  function clearGuide() {
    state.flowCancel = true;

    const old = document.getElementById(GUIDE_ID);
    if (old) old.remove();
    const st = document.getElementById(STYLE_ID);
    if (st) st.remove();

    window.removeEventListener("scroll", onReflow, true);
    window.removeEventListener("resize", onReflow, true);

    state.target = null;
    state.ui = null;
  }

  // Sentence intent extraction
  const STOPWORDS = new Set([
    "please","can","could","you","help","me","to","find","search","locate","open","go","navigate","click","show",
    "take","bring","the","a","an","for","of","on","in","within","this","that","website","site","page","app",
    "button","tab","menu","section","link","icon","option","settings","setting"
  ]);

  function extractQuery(input) {
    const raw = (input || "").trim();
    if (!raw) return "";

    const quoted = raw.match(/["“”'‘’]([^"“”'‘’]{1,80})["“”'‘’]/);
    if (quoted) return quoted[1].trim();

    let s = raw;

    s = s.replace(/^(please\s+)?(can\s+you\s+|could\s+you\s+)?(help\s+me\s+(to\s+)?)?/i, "");
    s = s.replace(/^(find|search\s*for|search|locate|open|go\s+to|navigate\s+to|click|show|take\s+me\s+to|bring\s+me\s+to)\s+/i, "");
    s = s.replace(/\b(button|tab|menu|page|section|link|icon|option|settings|setting)\b/gi, " ");
    s = s.replace(/\s+(on|in|within)\s+(this|the)?\s*([a-z0-9 ._-]+)(website|site|page|app)?\s*$/i, " ");
    s = s.replace(/\s+/g, " ").trim();

    const words = s
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean)
      .filter(w => !STOPWORDS.has(w.toLowerCase()));

    if (words.length === 0) return raw;
    return words.slice(0, 6).join(" ");
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${GUIDE_ID}{position:fixed;inset:0;z-index:2147483647}
      #${GUIDE_ID} *{box-sizing:border-box}

      .ht-backdrop{
        position:fixed; inset:0;
        background: rgba(0,0,0,0.35);
        -webkit-backdrop-filter: blur(2px) saturate(1.1);
        backdrop-filter: blur(2px) saturate(1.1);
        pointer-events:auto;
      }

      .ht-ring{
        position:fixed;
        border-radius:12px;
        pointer-events:none;
        box-shadow:
          0 0 0 3px rgba(37,99,235,1),
          0 0 22px rgba(37,99,235,0.85);
        animation: htPulse 1.2s ease-in-out infinite;
        transition: left .15s ease, top .15s ease, width .15s ease, height .15s ease;
      }
      @keyframes htPulse{0%{transform:scale(1)}50%{transform:scale(1.01)}100%{transform:scale(1)}}

      .ht-label{
        position:fixed;
        width:320px;
        padding:10px 12px;
        border-radius:10px;
        background:#111;
        color:#fff;
        font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto;
        box-shadow:0 10px 26px rgba(0,0,0,0.35);
        pointer-events:auto;
      }

      .ht-arrow{
        position:fixed;
        height:${ARROW_THICKNESS}px;
        border-radius:999px;
        background:${ARROW_COLOR};
        transform-origin:left center;
        pointer-events:none;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,.35));
      }
      .ht-arrow:after{
        content:"";
        position:absolute;
        right:-2px;
        top:50%;
        transform: translateY(-50%);
        width:0;height:0;
        border-left:${ARROW_HEAD_LEN}px solid ${ARROW_COLOR};
        border-top:${ARROW_HEAD_HALF}px solid transparent;
        border-bottom:${ARROW_HEAD_HALF}px solid transparent;
      }

      .ht-btn{
        margin-top:8px;
        width:100%;
        padding:8px 10px;
        border:1px solid rgba(255,255,255,0.2);
        background:rgba(255,255,255,0.08);
        color:#fff;
        border-radius:8px;
        cursor:pointer;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function applyHoleMask(backdropEl, x, y, w, h) {
    const full = "linear-gradient(#000 0 0)";
    const hole = "linear-gradient(#000 0 0)";

    backdropEl.style.webkitMaskImage = `${full}, ${hole}`;
    backdropEl.style.webkitMaskRepeat = "no-repeat, no-repeat";
    backdropEl.style.webkitMaskPosition = `0 0, ${x}px ${y}px`;
    backdropEl.style.webkitMaskSize = `100% 100%, ${w}px ${h}px`;
    backdropEl.style.webkitMaskComposite = "xor";

    backdropEl.style.maskImage = `${full}, ${hole}`;
    backdropEl.style.maskRepeat = "no-repeat, no-repeat";
    backdropEl.style.maskPosition = `0 0, ${x}px ${y}px`;
    backdropEl.style.maskSize = `100% 100%, ${w}px ${h}px`;
    backdropEl.style.maskComposite = "exclude";
  }

  function getText(el) {
    return ((el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.value || "") + "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function escapeCss(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    if (el.id) return `#${escapeCss(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${escapeCss(node.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = Array.from(node.classList || [])
        .filter(Boolean)
        .slice(0, 2)
        .map((c) => `.${escapeCss(c)}`);
      if (classes.length) part += classes.join("");
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(node) + 1;
          part += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function isClickable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "a") return true;
    if (tag === "input") return ["button", "submit"].includes((el.getAttribute("type") || "").toLowerCase());
    if (el.getAttribute("role") === "button") return true;
    if (typeof el.onclick === "function") return true;
    return false;
  }

  function score(query, text) {
    const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    const t = (text || "").toLowerCase();
    let s = 0;
    for (const w of q) if (t.includes(w)) s += 3;
    if (t === query.toLowerCase()) s += 6;
    return s;
  }

  function getObservation(maxElements = 60) {
    const candidates = Array.from(
      document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true'],[tabindex]")
    )
      .filter((el) => el instanceof HTMLElement)
      .filter(isVisible);

    const elements = candidates.map((el) => {
      const rect = el.getBoundingClientRect();
      const role = el.getAttribute("role") || "";
      const type = el.getAttribute("type") || "";
      return {
        tag: el.tagName.toLowerCase(),
        text: getText(el),
        selector: cssPath(el),
        role,
        type,
        ariaLabel: el.getAttribute("aria-label") || "",
        placeholder: el.getAttribute("placeholder") || "",
        value: "value" in el ? String(el.value || "") : "",
        href: el.getAttribute("href") || "",
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    });

    elements.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    return {
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      elements: elements.slice(0, maxElements)
    };
  }

  function resolveElement({ selector, text }) {
    if (selector) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) return el;
    }
    const query = String(text || "").trim().toLowerCase();
    if (!query) return null;
    const candidates = Array.from(
      document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link'],[contenteditable='true'],[tabindex]")
    )
      .filter((el) => el instanceof HTMLElement)
      .filter(isVisible)
      .map((el) => ({ el, text: getText(el) }))
      .filter((item) => item.text);

    candidates.sort((a, b) => score(query, b.text) - score(query, a.text));
    return candidates[0]?.el || null;
  }

  function findBest(query) {
    const q = String(query || "").trim();
    if (!q) return null;

    const els = Array.from(document.querySelectorAll("a,button,input,[role='button'],[tabindex]"))
      .filter((el) => el instanceof HTMLElement)
      .filter(isClickable)
      .map((el) => ({ el, text: getText(el) }))
      .filter((x) => x.text.length > 0)
      .map((x) => ({ ...x, s: score(q, x.text) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);

    return els[0] || null;
  }

  function findSearchInput() {
    const inputs = Array.from(document.querySelectorAll("input,textarea"))
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const type = (el.getAttribute("type") || "").toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const ph = (el.getAttribute("placeholder") || "").toLowerCase();
        if (role === "searchbox") return true;
        if (type === "search") return true;
        if (aria.includes("search")) return true;
        if (ph.includes("search")) return true;
        return false;
      });

    return inputs[0] || null;
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressEnter(el) {
    const evt = (type) => new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    el.dispatchEvent(evt("keydown"));
    el.dispatchEvent(evt("keypress"));
    el.dispatchEvent(evt("keyup"));
  }

  async function clickElement(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(200);
      el.focus?.();
      el.click();
      return true;
    } catch {
      return false;
    }
  }

  async function typeInto(el, text) {
    if (!el) return false;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(200);
      el.focus?.();
      el.value = "";
      dispatchInputEvents(el);
      el.value = String(text || "");
      dispatchInputEvents(el);
      return true;
    } catch {
      return false;
    }
  }

  function createUI() {
    clearGuide();
    ensureStyles();

    const root = document.createElement("div");
    root.id = GUIDE_ID;

    const backdrop = document.createElement("div");
    backdrop.className = "ht-backdrop";

    const ring = document.createElement("div");
    ring.className = "ht-ring";

    const arrow = document.createElement("div");
    arrow.className = "ht-arrow";

    const label = document.createElement("div");
    label.className = "ht-label";
    label.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px">Next step</div>
      <div id="ht-msg"></div>
      <button class="ht-btn" id="ht-close">Got it</button>
    `;

    root.appendChild(backdrop);
    root.appendChild(ring);
    root.appendChild(arrow);
    root.appendChild(label);
    document.documentElement.appendChild(root);

    const msgEl = label.querySelector("#ht-msg");
    label.querySelector("#ht-close").addEventListener("click", clearGuide);

    root.addEventListener("click", (e) => {
      if (!label.contains(e.target)) clearGuide();
    });

    state.ui = { root, backdrop, ring, arrow, label, msgEl };

    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow, true);
  }

  function pickLabelPosition(targetRect, labelW, labelH) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 14;
    const r = targetRect;

    const candidates = [
      { x: r.right + margin, y: clamp(r.top, 10, vh - labelH - 10) },
      { x: r.left - margin - labelW, y: clamp(r.top, 10, vh - labelH - 10) },
      { x: clamp(r.left, 10, vw - labelW - 10), y: r.bottom + margin },
      { x: clamp(r.left, 10, vw - labelW - 10), y: r.top - margin - labelH }
    ];

    const targetBox = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };

    let best = candidates[0];
    let bestScore = Infinity;

    for (const c of candidates) {
      const box = { left: c.x, top: c.y, right: c.x + labelW, bottom: c.y + labelH };
      const outX = Math.max(0, 10 - box.left) + Math.max(0, box.right - (vw - 10));
      const outY = Math.max(0, 10 - box.top) + Math.max(0, box.bottom - (vh - 10));
      const outPenalty = (outX + outY) * 1000;
      const overlapPenalty = rectOverlapArea(box, targetBox) * 10;

      const s = outPenalty + overlapPenalty;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }

    best.x = clamp(best.x, 10, vw - labelW - 10);
    best.y = clamp(best.y, 10, vh - labelH - 10);
    return best;
  }

  function boundaryPoint(rect, ux, uy) {
    const cx = (rect.left + rect.right) / 2;
    const cy = (rect.top + rect.bottom) / 2;
    const hx = (rect.right - rect.left) / 2;
    const hy = (rect.bottom - rect.top) / 2;

    const ax = Math.abs(ux) < 1e-6 ? 1e-6 : Math.abs(ux);
    const ay = Math.abs(uy) < 1e-6 ? 1e-6 : Math.abs(uy);

    const tx = hx / ax;
    const ty = hy / ay;
    const t = Math.min(tx, ty);

    return { x: cx + ux * t, y: cy + uy * t };
  }

  function place(el) {
    if (!state.ui) return;

    const r = el.getBoundingClientRect();
    const pad = 6;

    const left = Math.max(0, r.left - pad);
    const top = Math.max(0, r.top - pad);
    const width = Math.max(0, r.width + pad * 2);
    const height = Math.max(0, r.height + pad * 2);

    state.ui.ring.style.left = `${left}px`;
    state.ui.ring.style.top = `${top}px`;
    state.ui.ring.style.width = `${width}px`;
    state.ui.ring.style.height = `${height}px`;

    applyHoleMask(state.ui.backdrop, left, top, width, height);

    const labelW = 320;
    const labelH = 96;
    const pos = pickLabelPosition(r, labelW, labelH);

    state.ui.label.style.left = `${pos.x}px`;
    state.ui.label.style.top = `${pos.y}px`;

    const targetRect = { left, top, right: left + width, bottom: top + height };
    const labelRect = { left: pos.x, top: pos.y, right: pos.x + labelW, bottom: pos.y + labelH };

    const lcX = (labelRect.left + labelRect.right) / 2;
    const lcY = (labelRect.top + labelRect.bottom) / 2;
    const tcX = (targetRect.left + targetRect.right) / 2;
    const tcY = (targetRect.top + targetRect.bottom) / 2;

    const vx = tcX - lcX;
    const vy = tcY - lcY;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;

    const start = boundaryPoint(labelRect, ux, uy);
    const end = boundaryPoint(targetRect, -ux, -uy);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const alen = Math.max(40, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    state.ui.arrow.style.left = `${start.x}px`;
    state.ui.arrow.style.top = `${start.y}px`;
    state.ui.arrow.style.width = `${alen}px`;
    state.ui.arrow.style.transform = `rotate(${angle}deg)`;
  }

  function onReflow() {
    if (state.target) place(state.target);
  }

  async function guideTo(el, message, autoClick) {
    state.target = el;
    createUI();
    state.ui.msgEl.textContent = message || "Click the highlighted element.";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(180);
    place(el);

    if (autoClick) {
      await sleep(250);
      await clickElement(el);
    }
  }

  // Retry for late DOM
  async function findBestWithRetry(query, ms = 2000) {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const best = findBest(query);
      if (best) return best;
      await sleep(250);
    }
    return null;
  }

  // FLOW execution
  function splitSteps(raw) {
    const s = String(raw || "").trim();
    if (!s) return [];
    const normalized = s.replace(/\b(and\s+then|then)\b/gi, ",").replace(/[;]+/g, ",");
    const parts = normalized.split(",").map((x) => x.trim()).filter(Boolean);
    return parts.length ? parts : [s];
  }

  function parseSearch(step) {
    const m = step.match(/\bsearch\s*(for)?\s+(.+)$/i);
    if (!m) return null;
    return m[2].trim();
  }

  function parsePlay(step) {
    // play/open/watch <something> (video)
    const m = step.match(/\b(play|open|watch)\s+(.+)$/i);
    if (!m) return null;
    return m[2].trim();
  }

  async function doSearch(text) {
    const input = findSearchInput();
    if (!input) return { ok: false, message: "No search box found on this page." };

    await guideTo(input, `Typing: "${text}"`, true);
    await sleep(200);
    await typeInto(input, text);
    await sleep(150);
    pressEnter(input);
    return { ok: true };
  }

  async function doClickByText(q, autoClick) {
    const usedQuery = extractQuery(q);
    const best = await findBestWithRetry(usedQuery, 2500);
    if (!best) return { ok: false, message: `No matching element found for: "${usedQuery}"`, usedQuery };
    await guideTo(best.el, `Click: "${best.text}"`, autoClick);
    return { ok: true, targetText: best.text, usedQuery };
  }

  async function doPlayOnYouTube(query) {
    // If user says "second video" or "recent video", click 2nd visible thumbnail
    const lower = query.toLowerCase();
    const wantsSecond = lower.includes("second");
    const wantsRecent = lower.includes("recent") || lower.includes("latest");

    const videoLinks = Array.from(document.querySelectorAll("a#video-title, a.yt-simple-endpoint#video-title"))
      .filter((a) => a instanceof HTMLElement)
      .filter((a) => (a.getAttribute("href") || "").includes("/watch"));

    if (videoLinks.length === 0) {
      // fallback: any /watch links
      const anyLinks = Array.from(document.querySelectorAll("a"))
        .filter((a) => a instanceof HTMLElement)
        .filter((a) => (a.getAttribute("href") || "").includes("/watch"));
      if (anyLinks.length > 0) videoLinks.push(...anyLinks.slice(0, 20));
    }

    if (videoLinks.length === 0) return { ok: false, message: "No videos found to play." };

    if (wantsSecond) {
      const el = videoLinks[1] || videoLinks[0];
      await guideTo(el, `Playing: "${getText(el)}"`, true);
      return { ok: true };
    }

    if (wantsRecent) {
      const el = videoLinks[0];
      await guideTo(el, `Playing: "${getText(el)}"`, true);
      return { ok: true };
    }

    // Try match by text
    const best = videoLinks
      .map((el) => ({ el, text: getText(el), s: score(query, getText(el)) }))
      .sort((a, b) => b.s - a.s)[0];

    if (best && best.s > 0) {
      await guideTo(best.el, `Playing: "${best.text}"`, true);
      return { ok: true };
    }

    // fallback first
    await guideTo(videoLinks[0], `Playing: "${getText(videoLinks[0])}"`, true);
    return { ok: true };
  }

  async function runFlow(rawSteps, autoClick) {
    if (state.running) return { ok: false, message: "Already running a flow." };
    state.running = true;
    state.flowCancel = false;

    try {
      const steps = Array.isArray(rawSteps) ? rawSteps : splitSteps(rawSteps);
      if (!steps.length) return { ok: false, message: "No steps found." };

      let done = 0;

      for (let i = 0; i < steps.length; i++) {
        if (state.flowCancel) return { ok: false, message: "Flow cancelled." };

        const step = steps[i];

        // 1) search for X
        const searchText = parseSearch(step);
        if (searchText) {
          const res = await doSearch(searchText);
          if (!res.ok) return { ok: false, message: res.message, step: i + 1 };
          done++;
          await sleep(800);
          continue;
        }

        // 2) play/watch/open on YouTube
        const play = parsePlay(step);
        const host = location.hostname.toLowerCase();
        if (play && host.includes("youtube.com")) {
          const res = await doPlayOnYouTube(play);
          if (!res.ok) return { ok: false, message: res.message, step: i + 1 };
          done++;
          await sleep(800);
          continue;
        }

        // 3) default click by text
        const res = await doClickByText(step, !!autoClick);
        if (!res.ok) return { ok: false, message: res.message, step: i + 1 };
        done++;
        await sleep(700);
      }

      return { ok: true, mode: "flow", done, total: steps.length };
    } finally {
      state.running = false;
    }
  }

  async function executeAgentAction(action) {
    const before = location.href;
    const safeAction = action || {};
    let ok = false;
    let message = "";

    if (safeAction.type === "click") {
      const el = resolveElement(safeAction);
      if (!el) return { ok: false, navigated: false, message: "Element not found for click." };
      await guideTo(el, safeAction.reason || "Agent click", true);
      ok = true;
    } else if (safeAction.type === "type") {
      const el = resolveElement(safeAction);
      if (!el) return { ok: false, navigated: false, message: "Element not found for typing." };
      await guideTo(el, safeAction.reason || "Agent type", false);
      await typeInto(el, safeAction.value || "");
      if (safeAction.enter) pressEnter(el);
      ok = true;
    } else if (safeAction.type === "scroll") {
      const delta = Number(safeAction.deltaY || 0);
      window.scrollBy({ top: delta, behavior: "smooth" });
      await sleep(200);
      ok = true;
    } else if (safeAction.type === "wait") {
      const ms = Number(safeAction.ms || 800);
      await sleep(ms);
      ok = true;
    } else if (safeAction.type === "done") {
      ok = true;
      message = "Done.";
    } else {
      const ms = Number(safeAction.ms || 800);
      await sleep(ms);
      ok = true;
      message = "Unknown action, waiting.";
    }

    const navigated = location.href !== before;
    return { ok, navigated, message };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === "AGENT_GET_OBSERVATION") {
      sendResponse({ ok: true, observation: getObservation(60) });
      return true;
    }

    if (msg?.type === "AGENT_EXECUTE") {
      (async () => {
        const res = await executeAgentAction(msg.action || {});
        sendResponse({ ok: true, result: res });
      })();
      return true;
    }

    if (msg?.type === "CLEAR_GUIDE") {
      clearGuide();
      sendResponse({ ok: true });
      return true;
    }

    if (msg?.type === "GUIDE") {
      (async () => {
        const raw = (msg.query || "").trim();
        const usedQuery = extractQuery(raw);

        const best = await findBestWithRetry(usedQuery, 2000);
        if (!best) {
          sendResponse({ ok: false, message: `No matching element found for: "${usedQuery}"`, usedQuery });
          return;
        }

        await guideTo(best.el, `Click: "${best.text}"`, !!msg.autoClick);
        sendResponse({ ok: true, targetText: best.text, usedQuery });
      })();

      return true;
    }

    if (msg?.type === "FLOW") {
      (async () => {
        const steps = msg.steps || msg.query;
        const res = await runFlow(steps, !!msg.autoClick);
        sendResponse(res);
      })();

      return true;
    }

    sendResponse({ ok: false, message: "Unknown request" });
    return true;
  });
})();
