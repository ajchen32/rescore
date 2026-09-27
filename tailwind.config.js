/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        cream: "#F6F0E6",
        warmwhite: "#FFFBF5",
        brown: "#3A2A22",
        sand: "#F3E6D8",
        charcoal: "#1C1612",
        terracotta: "#C45C26",
        terracottaLight: "#E08A4F",
        warmborder: "#E5D9CC",
        warmborderDark: "#3D3229",
        warmsurface: "#2A211C",
        warmmuted: "#6B5A4E",
        warmmutedDark: "#B8A99A",
      },
    },
  },
  plugins: [],
};
