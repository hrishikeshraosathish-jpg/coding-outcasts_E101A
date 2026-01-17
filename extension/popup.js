// Summary: added local agent loop with storage-backed settings and progress logging.
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const queryEl = $("query");
  const guideBtn = $("guideBtn");
  const clearBtn = $("clearBtn");
  const statusEl = $("status");
  const serverUrlEl = $("serverUrl");
  const modelEl = $("model");
  const runAgentBtn = $("runAgentBtn");
  const stopAgentBtn = $("stopAgentBtn");
  const logEl = $("log");

  let stopRequested = false;
  let isRunning = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function appendLog(msg) {
    if (!logEl) return;
    const next = `${new Date().toLocaleTimeString()} ${msg}`;
    logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${next}` : next;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog() {
    if (logEl) logEl.textContent = "";
  }

  if (!queryEl || !guideBtn || !clearBtn || !statusEl || !serverUrlEl || !modelEl || !runAgentBtn || !stopAgentBtn || !logEl) {
    console.error("Popup HTML missing IDs.", {
      queryEl,
      guideBtn,
      clearBtn,
      statusEl,
      serverUrlEl,
      modelEl,
      runAgentBtn,
      stopAgentBtn,
      logEl
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

  async function loadSettings() {
    const stored = await chrome.storage.local.get({
      serverUrl: "http://localhost:3000",
      model: "llama3.1:8b"
    });
    serverUrlEl.value = stored.serverUrl;
    modelEl.value = stored.model;
  }

  function persistSettings() {
    chrome.storage.local.set({
      serverUrl: serverUrlEl.value.trim(),
      model: modelEl.value.trim()
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function requestPlan(serverUrl, payload) {
    const resp = await fetch(`${serverUrl.replace(/\/$/, "")}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || `Server error ${resp.status}`);
    }
    return resp.json();
  }

  async function runAgent() {
    const goal = (queryEl.value || "").trim();
    if (!goal) {
      setStatus("Enter a goal to run the agent.");
      return;
    }

    if (isRunning) {
      setStatus("Agent already running.");
      return;
    }

    stopRequested = false;
    isRunning = true;
    clearLog();
    appendLog(`Goal: ${goal}`);

    const serverUrl = serverUrlEl.value.trim() || "http://localhost:3000";
    const model = modelEl.value.trim() || "llama3.1:8b";

    try {
      const tab = await getActiveTab();
      const url = String(tab.url || "");

      if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
        setStatus("This page is restricted. Open a normal website tab.");
        return;
      }

      const ping = await sendToTab(tab.id, { type: "PING" });
      if (!ping || !ping.ok) {
        setStatus("No content script. Refresh the page once.");
        return;
      }

      const history = [];
      setStatus("Agent running...");

      for (let step = 1; step <= 8; step += 1) {
        if (stopRequested) {
          appendLog("Stopped by user.");
          setStatus("Stopped.");
          return;
        }

        const obsResp = await sendToTab(tab.id, { type: "AGENT_GET_OBSERVATION" });
        if (!obsResp || !obsResp.ok) {
          appendLog("Failed to get observation.");
          setStatus("Observation failed.");
          return;
        }

        let planResponse;
        try {
          planResponse = await requestPlan(serverUrl, {
            goal,
            observation: obsResp.observation,
            history,
            model
          });
        } catch (error) {
          const msg = error?.message || String(error);
          if (msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
            setStatus("Local server not reachable. Start it with: cd server && npm i && npm run dev");
          } else if (msg.includes("Ollama")) {
            setStatus("Ollama not running. Start Ollama and pull model: ollama pull llama3.1:8b");
          } else {
            setStatus(msg);
          }
          appendLog(`Planner error: ${msg}`);
          return;
        }

        const action = planResponse.action || planResponse;
        appendLog(`Step ${step}: ${JSON.stringify(action)}`);

        if (action.type === "done") {
          setStatus("Goal complete.");
          appendLog("Agent finished.");
          return;
        }

        const execResp = await sendToTab(tab.id, { type: "AGENT_EXECUTE", action });
        if (!execResp || !execResp.ok) {
          appendLog("Execution failed.");
          setStatus("Execution failed.");
          return;
        }

        history.push({ action, result: execResp.result });
        while (history.length > 6) history.shift();

        await delay(600 + Math.floor(Math.random() * 300));
      }

      setStatus("Max steps reached.");
      appendLog("Stopped after max steps.");
    } catch (error) {
      console.error(error);
      setStatus("Open a normal website tab and try again.");
    } finally {
      isRunning = false;
    }
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
        autoClick: shouldAuto(q)
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

  runAgentBtn.addEventListener("click", () => {
    persistSettings();
    runAgent();
  });

  stopAgentBtn.addEventListener("click", () => {
    stopRequested = true;
    setStatus("Stopping...");
  });

  serverUrlEl.addEventListener("change", persistSettings);
  modelEl.addEventListener("change", persistSettings);

  loadSettings();
  setStatus("Ready.");
});
