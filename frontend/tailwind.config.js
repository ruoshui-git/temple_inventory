import frappeUIPreset, { content } from 'frappe-ui/tailwind'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [frappeUIPreset],
  // `content` must be spread into the app's own config: Tailwind v3 does not
  // merge `content` from a preset, so without this none of frappe-ui's own
  // utility classes are compiled and the UI renders unstyled.
  content: [...content, './index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
}
