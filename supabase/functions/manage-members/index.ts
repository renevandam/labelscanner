// Gebruikersbeheer voor de labelscanner. Alleen beheerders (role = 'editor') mogen dit aanroepen.
// Acties: list | add { email, role } | set_role { user_id, role } | reset_password { user_id } | remove { user_id }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["scanner", "editor"];

// Leesbaar tijdelijk wachtwoord zonder verwarrende tekens (0/O, 1/l/I).
function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: me } = await asUser.auth.getUser();
  const { data: isEditor } = await asUser.rpc("is_label_editor");
  if (!me?.user || isEditor !== true) return json({ error: "not_an_editor" }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { action?: string; email?: string; role?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const list = async () => {
    const { data, error } = await admin.rpc("label_members_list");
    if (error) throw error;
    return data;
  };

  try {
    switch (body.action) {
      case "list":
        return json({ members: await list() });

      case "add": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const role = ROLES.includes(String(body.role)) ? String(body.role) : "scanner";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "bad_email" }, 400);

        let { data: userId } = await admin.rpc("label_user_id_by_email", { p_email: email });
        let password: string | null = null;
        if (!userId) {
          password = tempPassword();
          const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
          if (error) return json({ error: "create_failed", message: error.message }, 400);
          userId = data.user.id;
        }
        const { error } = await admin.from("label_members").upsert({ user_id: userId, role }, { onConflict: "user_id" });
        if (error) throw error;
        return json({ members: await list(), created: !!password, password });
      }

      case "set_role": {
        if (!body.user_id || !ROLES.includes(String(body.role))) return json({ error: "bad_request" }, 400);
        if (body.user_id === me.user.id) return json({ error: "not_yourself" }, 400);
        const { error } = await admin.from("label_members").update({ role: body.role }).eq("user_id", body.user_id);
        if (error) throw error;
        return json({ members: await list() });
      }

      case "reset_password": {
        if (!body.user_id) return json({ error: "bad_request" }, 400);
        const { data: member } = await admin.from("label_members").select("user_id").eq("user_id", body.user_id).maybeSingle();
        if (!member) return json({ error: "not_a_member" }, 404);
        const password = tempPassword();
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
        if (error) return json({ error: "reset_failed", message: error.message }, 400);
        return json({ members: await list(), password });
      }

      case "remove": {
        if (!body.user_id) return json({ error: "bad_request" }, 400);
        if (body.user_id === me.user.id) return json({ error: "not_yourself" }, 400);
        // Alleen de toegang tot de labelscanner vervalt; het account zelf blijft bestaan.
        const { error } = await admin.from("label_members").delete().eq("user_id", body.user_id);
        if (error) throw error;
        return json({ members: await list() });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("manage-members", e instanceof Error ? e.message : e);
    return json({ error: "server_error" }, 500);
  }
});
