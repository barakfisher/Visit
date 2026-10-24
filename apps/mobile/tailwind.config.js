/** @type {import('tailwindcss').Config} */
const { tokens } = require('./src/design/tokens');

module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: tokens.color.brand,
        'brand-pressed': tokens.color.brandPressed,
        'brand-soft': tokens.color.brandSoft,
        ink: tokens.color.ink,
        body: tokens.color.body,
        muted: tokens.color.muted,
        canvas: tokens.color.canvas,
        surface: tokens.color.surface,
        line: tokens.color.line,
        focus: tokens.color.focus,
        success: tokens.color.success,
        warning: tokens.color.warning,
        danger: tokens.color.danger,
        disabled: tokens.color.disabled,
      },
      borderRadius: { card: tokens.radius.card, control: tokens.radius.control },
      boxShadow: { card: tokens.shadow.card },
      spacing: { page: tokens.spacing.page, card: tokens.spacing.card, control: tokens.spacing.control },
    },
  },
  plugins: [],
};
