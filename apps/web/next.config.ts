import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@dah-pango/db', '@dah-pango/domain'],
};

export default config;
