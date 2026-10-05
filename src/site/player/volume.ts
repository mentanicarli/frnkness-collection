/** Какие «волны» показывать на иконке громкости (одна — тише половины). */
export function volumeWavesFor(sliderValue: number, muted: boolean): { first: boolean; second: boolean } {
    return { first: sliderValue > 0 && !muted, second: sliderValue >= 0.5 && !muted }
}
