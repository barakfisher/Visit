import { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

/** How long layout on a screen takes to settle after its content changes. Reanimated honours the device's reduce-motion setting by default. */
export const LAYOUT_MOTION_MS = 220;
const easing = Easing.inOut(Easing.quad);
export const LAYOUT_MOTION = { duration: LAYOUT_MOTION_MS, easing };
export const itemMoves = LinearTransition.duration(LAYOUT_MOTION_MS).easing(easing);
export const itemArrives = FadeIn.duration(LAYOUT_MOTION_MS);
export const itemLeaves = FadeOut.duration(LAYOUT_MOTION_MS);
