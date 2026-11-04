// This module exposes the service-role key: a client bundle importing it must
// fail the build, not silently resolve the key to undefined.
import "server-only";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function hasServerSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}
