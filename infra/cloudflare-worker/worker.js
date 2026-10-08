// Прозрачный посредник между сайтом frnkness.ru и Supabase (Cloudflare Worker).
//
// Зачем: часть пользователей в России не достаёт до *.supabase.co (ответы
// побольше зависают). Адрес *.workers.dev обычно открывается. Worker ничего
// не меняет: пересылает запрос на Supabase и возвращает ответ.
//
// - Любые пути (/rest/v1, /auth/v1, /storage/v1, /functions/v1, /realtime/v1),
//   любые методы (в том числе OPTIONS), все заголовки запроса и ответа
//   (CORS, Content-Range, Range, Authorization, apikey…); тело идёт потоком.
// - WebSocket (/realtime/v1/websocket) пробрасывается: запрос с Upgrade
//   пересылается как есть, Cloudflare сам соединяет клиента с Supabase.
// - Адрес Supabase зашит ниже. Это не секрет, а одна конкретная база, поэтому
//   через этот Worker нельзя ходить на чужие адреса. Ключей и секретов здесь
//   нет: ключ приложения (apikey) и токен входа приходят в заголовках запроса.
// - Ничего не логируется (ни адреса, ни заголовки, ни токены).
//
// Что Worker добавляет сам (сайт по этим заголовкам понимает, кто ответил):
//   x-frnk-proxy: 1                  на каждый ответ, который пришёл от Supabase
//   x-frnk-proxy-error: <причина>    на ответ-ошибку самого Worker (502, Supabase недоступен)
// и дописывает их в Access-Control-Expose-Headers, чтобы браузер дал сайту их прочитать.
// Больше ничего в ответах не меняется.

const UPSTREAM = 'https://momcakikuivtvxkmgjhx.supabase.co'

// Служебные адреса: /__health, /__bulk, /__test (ниже). Supabase таких путей не использует.

// Проверочный «тяжёлый» ответ: <адрес>/__bulk?kb=1024 отдаёт указанное число
// килобайт (1–5120) случайных данных, не обращаясь к Supabase. Если он
// скачивается целиком, а ответы побольше от supabase.co зависают, значит
// посредник решает задачу. Данных пользователей в нём нет.
const BULK_DEFAULT_KB = 1024
const BULK_MAX_KB = 5120
const BULK_CHUNK = 64 * 1024

// Страница самопроверки: <адрес>/__test. Открывается в браузере телефона и
// сама прогоняет проверки (жив ли Worker, доходит ли он до Supabase, скачивается
// ли «тяжёлый» ответ целиком), а для сравнения пробует тот же запрос напрямую
// на supabase.co. Ключ ниже публичный (publishable), тот же, что в коде сайта.
const TEST_APIKEY = 'sb_publishable_ept_0dlTFn9cWLM0wIK2JA_a7xNSx-I'
const TEST_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Проверка посредника</title>
<style>
body{font:16px/1.4 system-ui,sans-serif;margin:16px;max-width:36rem;color:#111;background:#fff}
@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}
h1{font-size:1.2rem}.row{padding:.5rem 0;border-bottom:1px solid #8884}.ok{color:#198754}.bad{color:#dc3545}
.info{color:#8a8a8a}#verdict{margin-top:1rem;font-weight:700;font-size:1.1rem}
</style></head><body>
<h1>Проверка посредника</h1>
<div id="rows"></div><div id="verdict"></div>
<script>
const KEY = '__APIKEY__', DIRECT = '__UPSTREAM__'
const rows = document.getElementById('rows')
function row(title) {
    const el = document.createElement('div')
    el.className = 'row info'
    el.textContent = '… ' + title
    rows.append(el)
    return (cls, text) => { el.className = 'row ' + cls; el.textContent = (cls === 'ok' ? '✓ ' : cls === 'bad' ? '✗ ' : 'ⓘ ') + title + ' — ' + text }
}
async function read(url, idleMs, onProgress) {
    const ctrl = new AbortController()
    let timer
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), idleMs) }
    const t0 = performance.now()
    arm()
    try {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
        const reader = res.body.getReader()
        let bytes = 0
        for (;;) {
            arm()
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.length
            if (onProgress) onProgress(bytes)
        }
        return { status: res.status, bytes, sec: (performance.now() - t0) / 1000 }
    } finally { clearTimeout(timer) }
}
const kb = (n) => (n / 1024).toFixed(0) + ' КБ'
async function step(title, url, idleMs, goodStatus) {
    const done = row(title)
    try {
        const r = await read(url, idleMs, (b) => { if (b > 65536) done('info', 'идёт… ' + kb(b)) })
        const good = goodStatus(r.status)
        done(good ? 'ok' : 'bad', 'ответ ' + r.status + ', ' + kb(r.bytes) + ', ' + r.sec.toFixed(1) + ' с')
        return good
    } catch (e) {
        done('bad', e && e.name === 'AbortError' ? 'нет данных ' + idleMs / 1000 + ' с — завис' : 'ошибка сети')
        return false
    }
}
;(async () => {
    const a = await step('1. Worker отвечает', '/__health', 8000, (s) => s === 200)
    const b = await step('2. Worker дошёл до Supabase', '/rest/v1/?apikey=' + KEY, 10000, (s) => s > 0)
    const c = await step('3. Тяжёлый ответ (2 МБ) скачался целиком', '/__bulk?kb=2048', 10000, (s) => s === 200)
    const d = await step('Для сравнения: тот же запрос к Supabase напрямую', DIRECT + '/rest/v1/?apikey=' + KEY, 8000, (s) => s > 0)
    const v = document.getElementById('verdict')
    if (a && b && c) { v.className = 'ok'; v.textContent = 'Успех: посредник работает.' + (d ? ' Напрямую тоже открывается — сравни с проверкой без VPN в мобильной сети.' : ' Напрямую Supabase не открылся — посредник нужен.') }
    else { v.className = 'bad'; v.textContent = 'Не прошло: ' + (!a ? 'Worker не отвечает.' : !b ? 'Worker не достаёт до Supabase.' : 'тяжёлый ответ завис.') }
})()
</script></body></html>`

const MARK = 'x-frnk-proxy'
const ERROR_MARK = 'x-frnk-proxy-error'

function exposeMarks(headers) {
    // Список «*» уже разрешает читать всё; без CORS-ответа дописывать нечего.
    if (!headers.has('access-control-allow-origin')) return
    const current = headers.get('access-control-expose-headers')
    if (current && current.trim() === '*') return
    headers.set('access-control-expose-headers', [current, MARK, ERROR_MARK].filter(Boolean).join(', '))
}

function bulkResponse(url) {
    const asked = Number.parseInt(url.searchParams.get('kb') ?? '', 10)
    const kb = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), BULK_MAX_KB) : BULK_DEFAULT_KB
    const total = kb * 1024
    // Случайные байты, не сжимаются: размер на проводе равен заявленному.
    const chunk = new Uint8Array(BULK_CHUNK)
    for (let i = 0; i < BULK_CHUNK; i += 65536) crypto.getRandomValues(chunk.subarray(i, i + 65536))
    let sent = 0
    const body = new ReadableStream({
        pull(controller) {
            const size = Math.min(BULK_CHUNK, total - sent)
            controller.enqueue(size === BULK_CHUNK ? chunk : chunk.subarray(0, size))
            sent += size
            if (sent >= total) controller.close()
        }
    })
    return new Response(body, {
        headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(total),
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
            [MARK]: '1'
        }
    })
}

function errorResponse(reason) {
    return new Response(JSON.stringify({ error: reason }), {
        status: 502,
        headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'access-control-allow-origin': '*',
            'access-control-expose-headers': `${MARK}, ${ERROR_MARK}`,
            [MARK]: '1',
            [ERROR_MARK]: reason
        }
    })
}

export default {
    async fetch(request) {
        const url = new URL(request.url)

        // Служебные адреса Worker (Supabase таких путей не использует), к Supabase не
        // обращаются. Проверка «Worker жив»: <адрес>/__health
        if (url.pathname === '/__health') {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', [MARK]: '1' }
            })
        }

        if (url.pathname === '/__bulk') return bulkResponse(url)
        if (url.pathname === '/__test') {
            return new Response(TEST_PAGE.replace('__APIKEY__', TEST_APIKEY).replace('__UPSTREAM__', UPSTREAM), {
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'no-store',
                    'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ${UPSTREAM}`
                }
            })
        }

        const headers = new Headers(request.headers)
        headers.delete('host')
        // Supabase-функции считают лимиты по первому адресу x-forwarded-for.
        // Без этого они увидели бы адрес Cloudflare; cf-connecting-ip ставит
        // сам Cloudflare, подделать его клиент не может.
        const clientIp = request.headers.get('cf-connecting-ip')
        if (clientIp) headers.set('x-forwarded-for', clientIp)

        const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
        const upstreamRequest = new Request(UPSTREAM + url.pathname + url.search, {
            method: request.method,
            headers,
            body: hasBody ? request.body : undefined,
            // Редиректы Supabase отдаём клиенту как есть, а не идём по ним сами.
            redirect: 'manual'
        })

        let response
        try {
            response = await fetch(upstreamRequest)
        } catch {
            return errorResponse('upstream-unreachable')
        }

        // WebSocket: ответ 101 с готовым соединением возвращается без изменений.
        if (response.status === 101 || request.headers.get('upgrade')?.toLowerCase() === 'websocket') return response

        // Копия ответа, чтобы можно было дописать заголовки; тело остаётся потоком.
        const out = new Response(response.body, response)
        out.headers.set(MARK, '1')
        exposeMarks(out.headers)
        return out
    }
}
