import values from './tokens.json';
export const tokens: {
  color: Record<string, string>;
  spacing: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  typography: { body: number; caption: number; title: number; bodyLineHeight: number; titleLineHeight: number };
  layout: { minTouchTarget: number; actionHeight: number; contentMaxWidth: number; formMaxWidth: number; compactBreakpoint: number };
  interaction: { focusWidth: number; focusOffset: number; disabledOpacity: number };
} = values;
