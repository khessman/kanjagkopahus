import { SYSTEM_PROMPT, buildUserMessage, RESPONSE_SCHEMA, PRICE_TABLE } from "./prompt.js";

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

    // --- Köp: starta en Stripe Checkout-session (5 kr, inbäddad) ---
    if (body.action === "create-checkout") {
      return handleCheckout(env, cors);
    }

    // --- Prislista: kategorier + schabloner för "Fyll i själv"-läget (gratis) ---
    if (body.action === "prices") {
      return json({ kategorier: priceList() }, 200, cors);
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

    // Storleksgräns: bromsar kostnaden per anrop (ett enskilt objekt ska inte
    // kunna bli orimligt dyrt). ~400 000 tecken är rejält tilltaget.
    const totalLen =
      docs.besiktning.length + docs.energirapport.length +
      docs.energideklaration.length + docs.fragelista.length;
    if (totalLen > 400000) {
      return json({ error: "Dokumenten är för stora för att analyseras." }, 413, cors);
    }

    // --- Betalning: gratis-anrop saknar paid_session; betalda måste verifieras ---
    // Vi kollar HÄR bara att sessionen är en äkta betald session. Om den redan är
    // förbrukad avgörs LÄNGRE NER – först efter cache-koll – så att ett återförsök
    // efter ett tappat svar ändå kan hämta det redan uträknade resultatet ur
    // cachen i stället för att blockeras (och kunden slipper betala igen).
    const paidSession = str(body.paid_session);
    let isPaid = false;
    let sessionUsed = false;
    if (paidSession) {
      const v = await verifyStripeSession(env, paidSession);
      if (!v.ok) return json({ error: v.error || "Betalning kunde inte verifieras." }, 402, cors);
      isPaid = true;
      if (env.RL_KV && (await env.RL_KV.get("sess:" + paidSession))) sessionUsed = true;
    }

    // Cache-nyckel = hash av dokumenttexterna. Identiskt underlag => samma svar
    // utan att köra AI igen (sparar pengar och tid). Cachen är deterministisk per
    // dokument, så en träff returneras alltid – även för en redan förbrukad session.
    const cacheable = env.MOCK !== "true";
    const cache = caches.default;
    const cacheKey = new Request(
      "https://kjkh-cache/" + (await sha256hex(canonicalDocs(docs)))
    );

    if (cacheable) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const cached = applyPrices(await hit.json());
        cached._cache = "hit";
        if (isPaid) await markConsumed(env, paidSession); // idempotent
        return json(cached, 200, cors);
      }
    }

    // Cache-miss: NU spärrar vi en redan förbrukad betalning (den kan annars inte
    // återanvändas för ett NYTT objekt).
    if (sessionUsed) {
      return json({ error: "Den här betalningen är redan använd." }, 402, cors);
    }

    // Rate limit (KV): bara GRATIS AI-anrop (efter cache-miss) räknas. Betalda
    // anrop har redan betalats och slipper bromsen.
    if (cacheable && !isPaid && env.RL_KV) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (await tooManyRequests(env.RL_KV, ip, 6, 60)) {
        return json(
          { error: "För många analyser på kort tid. Vänta en minut och försök igen." },
          429,
          cors
        );
      }
    }

    try {
      const result =
        env.MOCK === "true"
          ? mockAnalysis(docs)
          : await runAI(docs, env);
      if (cacheable) {
        try {
          await cache.put(
            cacheKey,
            new Response(JSON.stringify(result), {
              headers: {
                "content-type": "application/json",
                "Cache-Control": "max-age=2592000", // 30 dagar
              },
            })
          );
        } catch { /* cache-fel ska aldrig fälla ett lyckat svar */ }
      }
      // Förbruka betalningen först NÄR analysen lyckats (fel => kan försöka igen).
      if (isPaid) await markConsumed(env, paidSession);
      return json(applyPrices(result), 200, cors);
    } catch (err) {
      return json({ error: "Analysen misslyckades.", detalj: String(err) }, 502, cors);
    }
  },

  // Schemalagd "keep-warm": pingar Booli-parsern på Render så gratisnivån inte
  // somnar (kallstart tar ~30 s, varm ~0,1 s). Cron i wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch("https://booliparser.onrender.com/").catch(() => {})
    );
  },
};

// --- Stripe ---------------------------------------------------------------
// Skapar en inbäddad Checkout-session på 5 kr. Frontend monterar den och
// betalningen sker på plats (ingen omdirigering => uppladdade PDF:er bevaras).
async function handleCheckout(env, cors) {
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Betalning är inte konfigurerad." }, 503, cors);
  }
  const p = new URLSearchParams();
  p.set("mode", "payment");
  p.set("ui_mode", "embedded_page");
  p.set("redirect_on_completion", "never");
  p.set("line_items[0][quantity]", "1");
  p.set("line_items[0][price_data][currency]", "sek");
  p.set("line_items[0][price_data][unit_amount]", "500"); // 5,00 kr i öre
  p.set("line_items[0][price_data][product_data][name]", "Husanalys – ett uppslag");
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.STRIPE_SECRET_KEY,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: p.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    return json({ error: "Kunde inte starta betalning.", detalj: data?.error?.message }, 502, cors);
  }
  return json({ client_secret: data.client_secret, session_id: data.id }, 200, cors);
}

// Kontrollerar hos Stripe att en session faktiskt är betald.
async function verifyStripeSession(env, id) {
  if (!env.STRIPE_SECRET_KEY) return { ok: false, error: "Betalning är inte konfigurerad." };
  try {
    const res = await fetch(
      "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(id),
      { headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY } }
    );
    const data = await res.json();
    if (!res.ok) return { ok: false, error: "Kunde inte verifiera betalning." };
    if (data.payment_status !== "paid") return { ok: false, error: "Betalning ej genomförd." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Kunde inte nå betaltjänsten." };
  }
}

// Markerar en betald session som förbrukad (en betalning = en analys).
async function markConsumed(env, id) {
  if (!env.RL_KV) return;
  try {
    await env.RL_KV.put("sess:" + id, "used", { expirationTtl: 60 * 60 * 24 * 90 });
  } catch { /* ignoreras */ }
}

// Enkel rate limit i KV: räknar anrop per IP i fasta minutfönster. Fail-open
// (blockerar aldrig legitima användare om KV krånglar) – det hårda taket är
// ändå den förbetalda AI-potten.
async function tooManyRequests(kv, ip, limit, windowSec) {
  try {
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${ip}:${window}`;
    const current = parseInt((await kv.get(key)) || "0", 10);
    if (current >= limit) return true;
    // expirationTtl måste vara minst 60 s i KV.
    await kv.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSec) });
    return false;
  } catch {
    return false;
  }
}

// Sätter kostnaden per åtgärd från den fasta schablontabellen (utifrån AI:ns
// valda "kategori") och räknar om summeringen. Kategorin "annat" (eller okänd)
// behåller AI:ns egen uppskattning. Detta är enda källan för priserna, så
// samma åtgärd får alltid samma pris.
function applyPrices(d) {
  let lo = 0, hi = 0, any = false;
  for (const a of d.atgarder || []) {
    const p = PRICE_TABLE[a.kategori];
    if (p) { a.kostnad_lag_sek = p[0]; a.kostnad_hog_sek = p[1]; }
    if (typeof a.kostnad_lag_sek === "number" && typeof a.kostnad_hog_sek === "number") {
      lo += a.kostnad_lag_sek; hi += a.kostnad_hog_sek; any = true;
    }
  }
  d.summering = d.summering || {};
  d.summering.total_lag_sek = any ? lo : "n/a";
  d.summering.total_hog_sek = any ? hi : "n/a";
  return d;
}

// Kategorilista till "Fyll i själv"-läget: id, svensk etikett och schablon.
// Samma källa som AI-läget (PRICE_TABLE) så priserna alltid stämmer överens.
const PRICE_LABELS = {
  dranering: "Dränering",
  fuktsanering_kallare: "Fuktsanering källare",
  tak_omlaggning: "Takomläggning",
  tak_rengoring: "Takrengöring",
  elcentral: "Elcentral (byte)",
  el_omdragning: "Omdragning av el",
  tillaggsisolering_vind: "Tilläggsisolering vind",
  fonsterbyte: "Fönsterbyte",
  fasadmalning: "Fasadmålning",
  fasad_omputs: "Omputsning fasad",
  stambyte: "Stambyte",
  badrum: "Renovering badrum",
  kok: "Renovering kök",
  varmepump_luftvatten: "Värmepump (luft/vatten)",
  varmepump_luftluft: "Värmepump (luft/luft)",
  ventilation_ftx: "Ventilation (FTX)",
  avlopp_relining: "Relining avlopp",
  ytterdorr: "Ytterdörr (byte)",
  radon: "Radonåtgärd",
};
function priceList() {
  const out = Object.keys(PRICE_TABLE).map((id) => ({
    id,
    namn: PRICE_LABELS[id] || id,
    lag: PRICE_TABLE[id][0],
    hog: PRICE_TABLE[id][1],
  }));
  out.push({ id: "annat", namn: "Annat (eget pris)", lag: "n/a", hog: "n/a" });
  return out;
}

// Kanonisk sträng av de fyra dokumenten i fast ordning – bas för cache-hashen.
function canonicalDocs(docs) {
  return [docs.besiktning, docs.energirapport, docs.energideklaration, docs.fragelista].join(" ");
}

async function sha256hex(strval) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(strval));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
      // Prompt caching: SYSTEM_PROMPT är identisk för varje anrop (bara
      // dokumenttexten i messages varierar), så den cachas 5 min hos
      // Anthropic - billigare och snabbare vid flera analyser i följd.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
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
