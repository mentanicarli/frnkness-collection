// Edge Function admin-content: правки контента сайта коммитами в GitHub.
// Вся логика — в handler.ts; здесь только подключение к Deno и Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'
import { createHandler } from './handler.ts'
import { playsForRelease } from '../_shared/revert.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'admin-uploads'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
})

const handler = createHandler({
    env: {
        githubToken: Deno.env.get('GITHUB_TOKEN') || undefined,
        repo: Deno.env.get('GITHUB_REPO') || 'mentanicarli/frnkness-collection',
        branch: Deno.env.get('GITHUB_BRANCH') || 'main',
        workflow: Deno.env.get('GITHUB_WORKFLOW') || 'deploy-pages.yml',
        signingKey: Deno.env.get('BLOB_SIGNING_KEY') || SERVICE_ROLE_KEY
    },
    fetch: (input, init) => fetch(input, init),
    // getUser проверяет токен на сервере Auth, а app_metadata берёт из базы:
    // снятая роль admin действует сразу, без ожидания истечения JWT.
    async getUser(jwt) {
        const { data, error } = await supabase.auth.getUser(jwt)
        if (error || !data.user) return null
        return data.user
    },
    staging: {
        async download(path) {
            const { data, error } = await supabase.storage.from(BUCKET).download(path)
            if (error || !data) return null
            return new Uint8Array(await data.arrayBuffer())
        },
        async remove(paths) {
            await supabase.storage.from(BUCKET).remove(paths)
        },
        async list() {
            const { data, error } = await supabase.storage
                .from(BUCKET)
                .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } })
            if (error || !data) return []
            return data.map((o) => ({ name: o.name, created_at: o.created_at }))
        }
    },
    toBase64: (bytes) => encodeBase64(bytes),
    now: () => Date.now(),
    // Сервисный ключ обходит RLS: функция читает счётчики напрямую.
    async playsFor(releaseIds) {
        const { data, error } = await supabase.from('play_counts').select('track_key, plays')
        if (error) throw new Error(`play_counts: ${error.message}`)
        return Object.fromEntries(releaseIds.map((id) => [id, playsForRelease(id, data ?? [])]))
    }
})

Deno.serve(handler)
