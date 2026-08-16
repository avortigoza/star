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
        // Matches PUMA's brand pink (#e82a78, pixel-sampled from its mockup) so STAR and
        // PUMA share one visual identity. See github.com/avortigoza/puma.
        brand: {
          50: '#fef1f6',
          100: '#fce3ed',
          200: '#f9c3d9',
          300: '#f391b9',
          400: '#ee5e99',
          500: '#ea3e84',
          600: '#e82a78',
          700: '#c1155c',
          800: '#9d114a',
          900: '#7c0d3b',
          950: '#4a0823',
        },
      },
    },
  },
  plugins: [],
}
