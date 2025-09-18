// Root-level PostCSS config to satisfy Next.js workspace root resolution
// This mirrors the frontend's config so Tailwind runs regardless of root inference.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
