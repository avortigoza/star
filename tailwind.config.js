/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // True hot-pink family (hue ~333, near-full saturation, HIGH lightness) —
        // not muted/moderate like the previous pass, which read as crimson/red.
        // "Pink" perceptually needs both high saturation AND high lightness
        // together; darkening while desaturating is what makes a hue like this
        // look like brick red instead. Keep this palette the single source of
        // truth for STAR's accent color rather than hardcoding hex elsewhere.
        brand: {
          50: '#fff0f7',
          100: '#ffe0ee',
          200: '#ffbddb',
          300: '#ff8fc1',
          400: '#ff6bae',
          500: '#ff52a0',
          600: '#ff338f',
          700: '#ff0a78',
          800: '#e00065',
          900: '#b80053',
          950: '#8a003f',
        },
      },
    },
  },
  plugins: [],
}
