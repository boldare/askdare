import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // The starter lives in a pnpm monorepo; point Turbopack at its root.
  turbopack: { root: path.join(__dirname, '../..') },
};

export default config;
