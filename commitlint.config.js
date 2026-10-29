/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Bodies hold lists and Co-Authored-By trailers; don't wrap-police them.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
