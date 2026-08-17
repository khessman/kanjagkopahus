import { SYSTEM_PROMPT, buildUserMessage, RESPONSE_SCHEMA } from "./prompt.js";

// Cloudflare Worker: tar emot dokumenttexter, kör AI-analysen och returnerar
// strikt JSON. I MOCK-läge svarar den utan att anropa någon AI-leverantör.

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Använd POST." }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Ogiltig JSON i anropet." }, 400, cors);
    }

    // Förväntat: { besiktning, energirapport, energideklaration, fragelista }
    // (var och en är ren text, redan utdragen ur PDF på klientsidan).
    const docs = {
      besiktning: str(body.besiktning),
      energirapport: str(body.energirapport),
      energideklaration: str(body.energideklaration),
      fragelista: str(body.fragelista),
    };

    if (!docs.besiktning && !docs.energirapport && !docs.energideklaration && !docs.fragelista) {
      return json({ error: "Minst ett dokument måste skickas med." }, 400, cors);
    }

    try {
      const result =
        env.MOCK === "true"
          ? mockAnalysis(docs)
          : await runAI(docs, env);
      return json(result, 200, cors);
    } catch (err) {
      return json({ error: "Analysen misslyckades.", detalj: String(err) }, 502, cors);
    }
  },
};

// --- Skarpt AI-anrop (aktiveras när MOCK=false) ---------------------------
// Just nu skrivet mot Anthropics Messages-API. Byt endast denna funktion om du
// väljer en annan leverantör. Nyckeln kommer från env.AI_API_KEY (wrangler secret).
async function runAI(docs, env) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.AI_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001", // billig, räcker gott för detta
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(docs) }],
    }),
  });

  if (!res.ok) throw new Error(`AI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Om svaret kapades av token-taket blir JSON:en trasig – ge ett tydligt fel.
  if (data?.stop_reason === "max_tokens") {
    throw new Error("Svaret blev för långt (max_tokens). Höj taket.");
  }
  const text = data?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(extractJson(text));
  } catch (e) {
    throw new Error(`Kunde inte tolka AI-svaret som JSON: ${String(e)}`);
  }
}

// Plockar ut JSON även om modellen råkar linda in det i ```json ... ``` eller
// lägger till text före/efter. Faller tillbaka på råtexten.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

// --- Mock: färdigformaterat svar utan AI ----------------------------------
function mockAnalysis(docs) {
  const kallor = {
    besiktning: !!docs.besiktning,
    energirapport: !!docs.energirapport,
    energideklaration: !!docs.energideklaration,
    fragelista: !!docs.fragelista,
  };

  return {
    objekt: {
      typ: "n/a",
      byggar: "n/a",
      boarea_kvm: "n/a",
      energiklass: docs.energideklaration ? "n/a" : "n/a",
    },
    kallor,
    atgarder: [
      {
        rubrik: "Dränering (exempeldata)",
        beskrivning:
          "MOCK-svar. Här skulle en faktisk anmärkning ur besiktningen återges sakligt.",
        bradska: "inom_nagra_ar",
        kostnad_lag_sek: 90000,
        kostnad_hog_sek: 180000,
        sakerhet: "medel",
        kalla: "besiktning",
      },
      {
        rubrik: "Tilläggsisolering vind (exempeldata)",
        beskrivning: "MOCK-svar från energideklarationens förbättringsförslag.",
        bradska: "pa_sikt",
        kostnad_lag_sek: 25000,
        kostnad_hog_sek: 60000,
        sakerhet: "lag",
        kalla: "energideklaration",
      },
    ],
    summering: {
      total_lag_sek: 115000,
      total_hog_sek: 240000,
      kommentar: "MOCK-läge aktivt (MOCK=true). Sätt en riktig AI-nyckel för skarp analys.",
    },
    friskrivning: RESPONSE_SCHEMA.friskrivning,
  };
}

// --- Hjälpare -------------------------------------------------------------
function str(v) {
  return typeof v === "string" ? v : "";
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}
