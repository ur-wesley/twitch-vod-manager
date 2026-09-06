const plugin = require("tailwindcss/plugin");
const { getIconsCSSData } = require("@iconify/utils/lib/css/icons");
const mdiIcons = require("@iconify-json/mdi/icons.json");

const values = {};
for (const k of Object.keys(mdiIcons.icons)) {
  values[k] = k;
}
if (mdiIcons.aliases) {
  for (const k of Object.keys(mdiIcons.aliases)) {
    values[k] = k;
  }
}

const mdiPlugin = plugin(({ matchComponents }) => {
  matchComponents(
    {
      "i-mdi": (iconName) => {
        try {
          const data = getIconsCSSData(mdiIcons, [iconName], {
            iconSelector: ".icon",
          });
          if (!data.css || data.css.length === 0) return {};
          return {
            ...data.common.rules,
            ...data.css[0].rules,
          };
        } catch {
          return {};
        }
      },
    },
    {
      values,
    },
  );
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["variant", [".dark &", '[data-kb-theme="dark"] &']],
  content: ["./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      borderRadius: {
        xl: "var(--radius-xl)",
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        heading: ["var(--font-heading)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [require("tailwindcss-animate"), mdiPlugin],
};
