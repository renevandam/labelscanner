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

const PROMPT = `Dit is een foto van een verzendlabel (TKE / SLS) op een doos. Lees de ingevulde waarden uit.
Antwoord met ALLEEN een JSON-object met precies deze sleutels, alle waarden als string ("" als leeg of onleesbaar):
{"project":"","intern_order":"","unit":"","datum":"","coordinator":"","doos":"","lengte":"","pallet":"","rol":"","kabel":"","notitie":""}
- project: waarde bij "Project#", spaties behouden zoals gedrukt (bv "2022 821601")
- intern_order: waarde bij "Intern order#"
- unit: waarde bij "Unit#", hoofd-/kleine letters zoals gedrukt (bv "nl0802372")
- datum: waarde bij "Datum" als dag-maand-jaar (bv "11-4-2024")
- coordinator: waarde bij "Coordinator"
- doos/lengte/pallet/rol/kabel: het (meestal handgeschreven) getal op de lijn vóór dat woord onder "Verpakking"; alleen cijfers
- notitie: overige handgeschreven tekst op het label (bv paraaf + datum onderaan)
Verzin niets. Is de foto geen dergelijk label, geef dan alle velden "".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Alleen leden van de labelscanner mogen API-tegoed gebruiken.
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: member, error: memberErr } = await supa.rpc("is_label_member");
  if (memberErr || member !== true) return json({ error: "not_a_member" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "missing_api_key" }, 500);

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("LABEL_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });

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
  return json({ fields });
});
