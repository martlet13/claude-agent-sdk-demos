/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{js,ts,jsx,tsx,html}"],
  theme: {
    extend: {
      colors: {
        paper: "#f6efe4",
        ink: "#1c1917",
        clay: "#c2410c",
        sage: "#3f6212",
        moss: "#4d7c0f",
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Source Sans 3"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
