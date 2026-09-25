const raw = import.meta.env;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const clerkPublishableKey = clean(raw.VITE_CLERK_PUBLISHABLE_KEY);
const supabaseUrl = clean(raw.VITE_SUPABASE_URL).replace(/\/+$/, "");
const supabaseAnonKey = clean(raw.VITE_SUPABASE_ANON_KEY);

/** Clerk is only usable once a real publishable key is present. */
export const authEnabled = clerkPublishableKey.startsWith("pk_");

/** Supabase is only usable once the project URL and anon key are present. */
export const dbEnabled =
  /^https?:\/\//.test(supabaseUrl) && supabaseAnonKey.length > 20;

/**
 * Without Clerk there is nothing to sign in with, so the app opens straight
 * into sample data. This is what makes `npm run dev` work before any account
 * has been created.
 */
export const demoMode = !authEnabled;

export const env = {
  clerkPublishableKey,
  supabaseUrl,
  supabaseAnonKey,
  appUrl: clean(raw.VITE_APP_URL) || (typeof window === "undefined" ? "" : window.location.origin),
};

export const configSummary = {
  auth: authEnabled ? "clerk" : "demo",
  database: dbEnabled ? "supabase" : "sample-data",
};
