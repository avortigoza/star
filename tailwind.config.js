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
        // Soft, warm pink — deliberately lower saturation and a warmer hue
        // than a magenta/fuchsia pink, per explicit feedback that magenta
        // was too much. Keep this palette the single source of truth for
        // STAR's accent color rather than hardcoding hex values elsewhere.
        brand: {
          50: '#fcf3f5',
          100: '#f8e7eb',
          200: '#f1d0d8',
          300: '#e7acbb',
          400: '#db849a',
          500: '#d1617d',
          600: '#c84163',
          700: '#aa314f',
          800: '#8a2841',
          900: '#6f2034',
          950: '#471521',
        },
      },
    },
  },
  plugins: [],
}
