import type { Release } from '@/types'
import { escapeHtml } from './helpers'

/**
 * Разметка промо-карточки на главной. Общая для сайта и превью в админке.
 * Клики ведут в window.App — на сайте его поднимает legacy-runtime, в
 * админке карточка только показывается.
 */
export function renderPromoCardHtml(releaseId: string, release: Release): string {
    const promoCover = release.cover
    const promoTitle = escapeHtml(release.title)
    const promoId = escapeHtml(releaseId)
    return `
                <div class="release-card promo-release-card text-left relative w-full" data-fixed-accent="true" onclick="App.openRelease('${promoId}')" style="cursor: pointer; padding: clamp(1rem,2vw,1.625rem);">
                    <div class="flex flex-col sm:flex-row items-start sm:items-center" style="gap: clamp(1.125rem,3vw,2.5rem);">
                        <div class="promo-cover-wrap aspect-square overflow-hidden bg-[var(--bg)] flex-shrink-0" style="border-radius: 0.5rem;">
                            <img src="${promoCover}" alt="${promoTitle}" class="card-image w-full h-full object-cover" loading="eager" decoding="async" fetchpriority="high" onerror="this.style.display='none'">
                        </div>
                        <div class="flex-1 min-w-0 flex flex-col" style="gap: 1rem;">
                            <div class="promo-badge">последний релиз</div>
                            <h3 class="promo-title line-clamp-2 relative z-10" style="font-size: clamp(1.5rem,4vw,3.125rem); line-height: 1;">${promoTitle}</h3>
                            <div class="flex items-center gap-3">
                                <button class="promo-cta inline-flex items-center gap-2" style="height: 2.75rem; padding: 0 1.25rem; border-radius: 0.375rem; font-size: 0.8125rem;" onclick="App.openRelease('${promoId}')">
                                    Перейти
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `
}
