import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Staff sign in with a plain username. We store real accounts in Supabase Auth
// using a synthetic email under the hood so people never see or type an email.
export const EMAIL_DOMAIN = "shutterledger.local";
export function usernameToEmail(username) {
  return `${username.trim().toLowerCase().replace(/\s+/g, "")}@${EMAIL_DOMAIN}`;
}
