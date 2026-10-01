// Адрес и публичный ключ Supabase. Отдельный модуль, чтобы админка
// брала их без реестра релизов из config.ts.
const DEFAULT_SUPABASE_URL = 'https://momcakikuivtvxkmgjhx.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_ept_0dlTFn9cWLM0wIK2JA_a7xNSx-I'

// Fallback-значения нужны для локального запуска, если env не задан.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
