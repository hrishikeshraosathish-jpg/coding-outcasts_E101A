import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Use POST" }, { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { goal, observation, history } = body || {};
  if (!goal || !observation) {
    return Response.json({ ok: false, error: "Missing goal or observation" }, { status: 400, headers: corsHeaders });
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
      return Response.json(
        { ok: false, error: "Model did not return valid JSON", raw },
        { status: 200, headers: corsHeaders }
      );
    }

    return Response.json({ ok: true, ...parsed }, { status: 200, headers: corsHeaders });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders });
  }
}
