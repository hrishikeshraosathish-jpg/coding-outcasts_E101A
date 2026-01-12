import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  const { goal, observation, history } = req.body || {};
  if (!goal || !observation) {
    return res.status(400).json({ ok: false, error: "Missing goal or observation" });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      say: { type: "string" },
      action: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["click", "type", "scroll", "wait", "done"] },
          selector: { type: "string" },
          text: { type: "string" },
          value: { type: "string" },
          enter: { type: "boolean" },
          deltaY: { type: "number" },
          ms: { type: "number" }
        },
        required: ["type"]
      }
    },
    required: ["say", "action"]
  };

  try {
    const resp = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      input: [
        {
          role: "system",
          content:
            "You are a web navigation planner. Choose exactly one next action toward the goal. " +
            "Use observation.elements selectors when possible. If stuck, scroll or wait. " +
            "When goal is achieved, return action.type=done."
        },
        {
          role: "user",
          content: JSON.stringify({
            goal,
            url: observation.url,
            title: observation.title,
            viewport: observation.viewport,
            elements: observation.elements,
            history: Array.isArray(history) ? history.slice(-10) : []
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "hacktide_action",
          strict: true,
          schema
        }
      },
      max_output_tokens: 300
    });

    const raw = resp.output_text || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(200).json({ ok: false, error: "Model did not return valid JSON", raw });
    }

    return res.status(200).json({ ok: true, ...parsed });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
