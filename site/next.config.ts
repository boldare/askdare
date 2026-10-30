import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // The site lives in the pnpm monorepo and imports the workspace packages; point Turbopack at its root.
  turbopack: { root: path.join(__dirname, '../..') },
};

export default config;
