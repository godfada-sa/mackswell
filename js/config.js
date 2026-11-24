/* Supabase project connection settings.
 *
 * url      = Project URL          (Dashboard -> Project Settings -> API)
 * anonKey  = publishable key      (sb_publishable_... ; older projects: "anon public")
 *
 * This key is meant to be public: access to data is controlled by the Row Level
 * Security policies in supabase/schema.sql, never by hiding this key. A secret
 * key (sb_secret_... / service_role) must never appear in this file or any page.
 *
 * window.SUPABASE_CONFIG is only assigned when nothing has set it already, so
 * the end-to-end test suite can inject a mock project before this script runs.
 */
window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || {
  url: 'https://gpcjtdafwxsnmdepnmhl.supabase.co',
  anonKey: 'sb_publishable_dapVaGXAwY101-L1WCTW6w_32v5v4rv'
};
