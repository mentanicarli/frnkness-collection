// Edge Function account: действия пользователя над своим аккаунтом —
// смена пароля, смена ника, удаление аккаунта.
// Логика — в ../_shared/accountsCore.ts.
import { createAccountHandler } from '../_shared/accountsCore.ts'
import { accountsDeps } from '../_shared/accountsDeps.ts'

Deno.serve(createAccountHandler(accountsDeps()))
