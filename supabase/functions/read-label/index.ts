// Leest een foto van een TKE-doossticker uit met de Claude API.
// Vereist secret ANTHROPIC_API_KEY. Optioneel LABEL_MODEL (standaard claude-sonnet-5-5).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KEYS = ["project", "intern_order", "unit", "datum", "coordinator", "doos", "lengte", "pallet", "rol", "kabel", "notitie"];

const PROMPT = `Je krijgt een foto die een medewerker in een magazijn heeft gemaakt. De bedoeling is een verzendlabel van TKE (met SLS-logo) op een doos: een wit label met de velden Project#, Intern order#, Unit#, Datum, Coordinator en daaronder "Verpakking" met lijnen voor DOOS, LENGTE, PALLET, ROL, KABEL.

Beoordeel eerst de foto:
- "ander_label": de foto toont iets anders dan zo'n TKE/SLS-label (ander soort sticker, pakbon, verzendlabel van een vervoerder, geen label in beeld).
- "onleesbaar": het is wel zo'n label maar Project#, Intern order# of Unit# is niet betrouwbaar te lezen (onscherp, te donker, schittering, deels buiten beeld, te ver weg).
- "ok": het label is goed te lezen.

Antwoord met ALLEEN een JSON-object, zonder uitleg eromheen:
{"status":"ok","reden":"","twijfel":[],"project":"","intern_order":"","unit":"","datum":"","coordinator":"","doos":"","lengte":"","pallet":"","rol":"","kabel":"","notitie":""}

- reden: bij "ander_label" of "onleesbaar" een korte Nederlandse uitleg voor de medewerker (max 8 woorden, bv "foto is onscherp", "onderkant label valt buiten beeld", "dit is een DHL-verzendlabel"). Anders "".
- twijfel: lijst met de sleutels van velden die je wel hebt ingevuld maar waarvan je niet zeker bent (bv ["doos","datum"]).
- project: waarde bij "Project#", spaties behouden zoals gedrukt (bv "2022 821601")
- intern_order: waarde bij "Intern order#"
- unit: waarde bij "Unit#", hoofd-/kleine letters zoals gedrukt (bv "nl0802372")
- datum: waarde bij "Datum" als dag-maand-jaar (bv "11-4-2024")
- coordinator: waarde bij "Coordinator"
- doos/lengte/pallet/rol/kabel: het (meestal handgeschreven) getal op de lijn vóór dat woord onder "Verpakking"; alleen cijfers, "" als de lijn leeg is
- notitie: overige handgeschreven tekst op het label (bv paraaf + datum onderaan)
Alle veldwaarden zijn strings. Verzin niets: wat je niet kunt lezen laat je "". Bij "ander_label" laat je alle velden "".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Alleen leden van de labelscanner mogen API-tegoed gebruiken.
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: member, error: memberErr } = await supa.rpc("is_label_member");
  if (memberErr || member !== true) return json({ error: "not_a_member" }, 403);

  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();
  if (!apiKey) return json({ error: "missing_api_key" }, 500);
  // Alleen de sleutel zelf, geen spaties of extra tekst (en nooit de sleutel loggen).
  if (!/^sk-ant-[A-Za-z0-9_-]+$/.test(apiKey)) {
    console.error("ANTHROPIC_API_KEY heeft een ongeldig formaat (bevat extra tekst?)");
    return json({ error: "bad_api_key" }, 500);
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const image = body.image;
  const mediaType = body.mediaType ?? "image/jpeg";
  if (!image || typeof image !== "string" || image.length > 7_000_000) return json({ error: "bad_image" }, 400);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return json({ error: "bad_media_type" }, 400);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("LABEL_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
    });
  } catch (e) {
    console.error("fetch mislukt", e instanceof Error ? e.name : "onbekend");
    return json({ error: "model_unreachable" }, 502);
  }

  if (!res.ok) {
    console.error("anthropic", res.status, await res.text());
    return json({ error: "model_error", status: res.status }, 502);
  }

  const out = await res.json();
  const text: string = (out.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    console.error("unparseable", text);
  }
  const fields = Object.fromEntries(KEYS.map((k) => [k, parsed[k] == null ? "" : String(parsed[k]).trim()]));
  const status = ["ok", "onleesbaar", "ander_label"].includes(String(parsed.status)) ? String(parsed.status) : (match ? "ok" : "onleesbaar");
  const reden = typeof parsed.reden === "string" ? parsed.reden.slice(0, 120) : "";
  const twijfel = Array.isArray(parsed.twijfel) ? parsed.twijfel.filter((k) => KEYS.includes(String(k))).map(String) : [];
  return json({ status, reden, twijfel, fields });
});
