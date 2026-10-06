// Edge Function register: регистрация по нику (капча, правила, лимит по IP).
// Логика — в ../_shared/accountsCore.ts.
import { createRegisterHandler } from '../_shared/accountsCore.ts'
import { accountsDeps } from '../_shared/accountsDeps.ts'

Deno.serve(createRegisterHandler(accountsDeps()))
