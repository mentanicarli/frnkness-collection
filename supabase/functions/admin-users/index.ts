// Edge Function admin-users: управление пользователями из админки
// (admin и owner; роли — только owner).
// Логика — в ../_shared/accountsCore.ts.
import { createAdminUsersHandler } from '../_shared/accountsCore.ts'
import { accountsDeps } from '../_shared/accountsDeps.ts'

Deno.serve(createAdminUsersHandler(accountsDeps()))
