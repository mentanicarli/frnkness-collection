import { rpc } from '@/site/social/api'
import type { Recap, RecapState } from './types'

/**
 * Обращения сайта к «Итогам года». Пока итоги не открыты, my_recap_state
 * возвращает null, а year_recap отвечает «Недоступно».
 */
export const recapApi = {
    state: () => rpc<RecapState | null>('my_recap_state'),
    get: (year: number) => rpc<Recap>('year_recap', { p_year: year, p_user: null })
}
