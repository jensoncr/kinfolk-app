import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  hasServerSupabaseConfig,
  supabaseServiceRoleKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseServiceClient() {
  if (!hasServerSupabaseConfig()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
