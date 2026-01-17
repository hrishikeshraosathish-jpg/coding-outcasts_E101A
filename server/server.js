// Summary: adds a local HTTP planner server that proxies to Ollama and validates JSON actions.
import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";

const ACTION_TYPES = new Set(["click", "type", "scroll", "wait", "done"]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function extractFirstJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function sanitizeObservation(observation, maxElements = 60) {
  if (!observation || typeof observation !== "object") return null;
  const elements = Array.isArray(observation.elements) ? observation.elements.slice() : [];
  elements.sort((a, b) => {
    const ay = Number(a?.y ?? 0);
    const by = Number(b?.y ?? 0);
    if (ay !== by) return ay - by;
    const ax = Number(a?.x ?? 0);
    const bx = Number(b?.x ?? 0);
    return ax - bx;
  });
  return {
    url: observation.url,
    title: observation.title,
    viewport: observation.viewport,
    elements: elements.slice(0, maxElements)
  };
}

function normalizeAction(action) {
  if (!action || typeof action !== "object") {
    return { type: "wait", ms: 800, reason: "Invalid action payload." };
  }
  const type = ACTION_TYPES.has(action.type) ? action.type : "wait";
  return {
    type,
    selector: action.selector,
    text: action.text,
    value: action.value,
    enter: action.enter,
    deltaY: action.deltaY,
    ms: action.ms,
    reason: action.reason || ""
  };
}

function buildSystemPrompt() {
  return (
    "You are a web navigation planner for a browser extension. " +
    "Return ONLY a single JSON object (no markdown, no extra text) with this schema: " +
    '{"type":"click|type|scroll|wait|done","selector":"string?","text":"string?","value":"string?","enter":true|false,"deltaY":number,"ms":number,"reason":"short explanation"}. " +
    "Prefer selector if present. If no confident action, return wait with ms=800. " +
    "Return done when goal is achieved or no further action makes sense."
  );
}

async function callOllama({ goal, observation, history, model }) {
  const payload = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          goal,
          observation,
          history: Array.isArray(history) ? history.slice(-6) : []
        })
      }
    ],
    stream: false
  };

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ollama error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data?.message?.content || "";
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/plan") {
    try {
      const rawBody = await readBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const { goal, observation, history, model } = body || {};

      if (!goal || !observation) {
        sendJson(res, 400, { ok: false, error: "Missing goal or observation." });
        return;
      }

      const safeObservation = sanitizeObservation(observation, 60);
      const raw = await callOllama({ goal, observation: safeObservation, history, model });
      const jsonText = extractFirstJsonObject(raw);

      if (!jsonText) {
        sendJson(res, 200, {
          ok: false,
          error: "Model did not return JSON.",
          action: { type: "wait", ms: 800, reason: "No JSON returned." }
        });
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        sendJson(res, 200, {
          ok: false,
          error: "Invalid JSON from model.",
          action: { type: "wait", ms: 800, reason: "Invalid JSON returned." }
        });
        return;
      }

      const action = normalizeAction(parsed);
      sendJson(res, 200, { ok: true, action });
      return;
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error?.message || String(error),
        action: { type: "wait", ms: 800, reason: "Planner failed." }
      });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Planner server listening on http://localhost:${PORT}`);
});
