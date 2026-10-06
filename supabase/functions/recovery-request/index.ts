// Edge Function recovery-request: заявка «Забыли пароль?» владельцу
// (капча, лимиты, одинаковый ответ для любого ника).
// Логика — в ../_shared/accountsCore.ts.
import { createRecoveryHandler } from '../_shared/accountsCore.ts'
import { accountsDeps } from '../_shared/accountsDeps.ts'

Deno.serve(createRecoveryHandler(accountsDeps()))
