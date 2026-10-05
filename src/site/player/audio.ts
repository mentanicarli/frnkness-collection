/**
 * Единственный <audio> сайта. Его создаёт MiniPlayer.vue и регистрирует
 * здесь; движок плеера и караоке берут его отсюда.
 */
let audio: HTMLAudioElement | null = null

export function setAudio(el: HTMLAudioElement | null): void {
    audio = el
}

export function getAudio(): HTMLAudioElement | null {
    return audio
}
