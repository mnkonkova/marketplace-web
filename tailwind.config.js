/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./web/index.html", "./web/**/*.js"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#050507",
          900: "#08090c",
          800: "#0c0d11",
          700: "#121317",
          600: "#191b20",
          500: "#22252b",
          400: "#3a3f4a",
        },
        mint: {
          600: "#3bc2ad",
          500: "#4ad6c1",
          400: "#6eded0",
          300: "#9fe9dd",
        },
        danger: "#ff6470",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      letterSpacing: {
        overline: "0.22em",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 14px 40px -22px rgba(0,0,0,0.8)",
        "cta-mint": "0 10px 28px -14px rgba(74,214,193,0.55)",
      },
    },
  },
  plugins: [],
};
