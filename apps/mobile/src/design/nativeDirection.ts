/**
 * Native and web disagree about "left" and "right" under RTL. On web they are physical. On iOS and Android, where
 * React Native swaps them by default, `textAlign: 'right'` lands on the left and a left border draws on the right.
 * Browser checks cannot see this, so both rules live here (decisions.md, "Native RTL").
 */

/** Text aligned to the start of its language: named on web, left to the layout's own direction on native. */
export function startAlignment(platform: string, direction: 'rtl' | 'ltr') {
  if (platform !== 'web') return {};
  return { textAlign: direction === 'rtl' ? 'right' : 'left' } as const;
}

/** For a shape drawn from one-sided borders or `left` offsets. An icon's geometry is not text and must never mirror. */
export const physicalDrawing = { direction: 'ltr' } as const;
