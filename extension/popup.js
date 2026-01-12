document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const queryEl = $("query");
  const guideBtn = $("guideBtn");
  const clearBtn = $("clearBtn");
  const statusEl = $("status");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  if (!queryEl || !guideBtn || !clearBtn || !statusEl) {
    console.error("Popup HTML missing IDs. Need: query, guideBtn, clearBtn, status", {
      queryEl,
      guideBtn,
      clearBtn,
      statusEl,
    });
    return;
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) throw new Error("No active tab");
    return tab;
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, message: err.message || String(err) });
          return;
        }
        resolve(resp || { ok: false, message: "No response from content script." });
      });
    });
  }

  function splitSteps(raw) {
    const s = String(raw || "").trim();
    if (!s) return [];

    const normalized = s
      .replace(/\b(and\s+then|then)\b/gi, ",")
      .replace(/[;]+/g, ",");

    const parts = normalized
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    return parts.length ? parts : [s];
  }

  function shouldAuto(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) return false;
    if (s.split(/\s+/).filter(Boolean).length === 1) return true;
    return /\b(go to|open|click|press|navigate|play|watch|select|choose|search|look up|type|enter)\b/.test(s);
  }

  guideBtn.addEventListener("click", async () => {
    const q = (queryEl.value || "").trim();
    if (!q) {
      setStatus('Try: "go to subscriptions, play MKBHD" or "search for bengal famine"');
      return;
    }

    try {
      const tab = await getActiveTab();
      const url = String(tab.url || "");

      if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
        setStatus("This page is restricted. Open a normal website tab.");
        return;
      }

      const steps = splitSteps(q);
      const res = await sendToTab(tab.id, {
        type: steps.length > 1 ? "FLOW" : "GUIDE",
        query: q,
        steps,
        autoClick: shouldAuto(q),
      });

      if (res && res.ok) {
        if (res.mode === "flow") {
          setStatus(`Flow: ${res.done || 0}/${res.total || steps.length} done`);
        } else {
          setStatus(`OK: matched "${res.usedQuery || q}"`);
        }
        return;
      }

      const m = (res && res.message) || "Not found.";
      if (m.includes("Receiving end does not exist")) {
        setStatus("Refresh the website tab once, then press Guide again.");
        return;
      }
      setStatus(m);
    } catch (e) {
      console.error(e);
      setStatus("Open a normal website tab and try again.");
    }
  });

  clearBtn.addEventListener("click", async () => {
    try {
      const tab = await getActiveTab();
      const res = await sendToTab(tab.id, { type: "CLEAR_GUIDE" });
      if (res && res.ok) setStatus("Cleared.");
      else setStatus((res && res.message) || "Nothing to clear.");
    } catch (e) {
      console.error(e);
      setStatus("Open a normal website tab and try again.");
    }
  });

  setStatus("Ready.");
});
