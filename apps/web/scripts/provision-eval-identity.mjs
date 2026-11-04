// Provisions the dedicated identity the agent simulation evals write against
// (see evals/README.md). Idempotent: reuses existing rows on re-run.
//
//   node scripts/provision-eval-identity.mjs
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const EVAL_PHONE = "+19999990042";
const EVAL_NAME = "Kinfolk Eval Bot";

async function main() {
  let user = (
    await supabase.from("kinfolk_users").select("id").eq("phone_e164", EVAL_PHONE).maybeSingle()
  ).data;
  if (!user) {
    const inserted = await supabase
      .from("kinfolk_users")
      .insert({
        about_text: "Synthetic identity used by evals/ agent simulations. Not a real person.",
        display_name: EVAL_NAME,
        phone_e164: EVAL_PHONE,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    user = inserted.data;
    console.log("created eval user");
  }

  let thread = (
    await supabase
      .from("text_threads")
      .select("id")
      .eq("from_phone_e164", EVAL_PHONE)
      .maybeSingle()
  ).data;
  if (!thread) {
    const inserted = await supabase
      .from("text_threads")
      .insert({
        from_phone_e164: EVAL_PHONE,
        provider: "sendblue",
        to_phone_e164: process.env.SENDBLUE_FROM_NUMBER ?? "+10000000000",
        user_id: user.id,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    thread = inserted.data;
    console.log("created eval thread");
  }

  console.log(`KINFOLK_EVAL_USER_ID=${user.id}`);
  console.log(`KINFOLK_EVAL_THREAD_ID=${thread.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
