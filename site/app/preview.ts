// The link preview, rendered by site/scripts/readme-images.mjs. Set in metadata rather than as
// app/opengraph-image.png: Turbopack ignores the opengraph-image.alt.txt beside that file. Pages
// that set their own openGraph repeat it, since Next.js replaces the object instead of merging it.
export const PREVIEW = {
  url: '/askdare-og.png',
  width: 1280,
  height: 640,
  alt: 'askdare: an AI assistant for any website, in one script tag. A chat panel answers a question about a pricing plan with a list, a table and two cited sources.',
};
