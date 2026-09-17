require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    'Missing Supabase credentials. Pastikan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY ada di .env'
  );
}

/**
 * Supabase admin client (service role) — bypass RLS
 * Digunakan untuk operasi server-side yang butuh akses penuh
 */
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Supabase anon client — tunduk pada Row Level Security
 * Digunakan untuk operasi yang dikaitkan dengan session user
 */
const supabaseAnon = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY);

module.exports = { supabaseAdmin, supabaseAnon };
