/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages export raw TypeScript source (main: ./src/index.ts).
  // Next must transpile them, AND its webpack must understand that
  // an import ending in '.js' may resolve to a '.ts' file in those packages —
  // which is the modern Node ESM convention TypeScript follows.
  transpilePackages: [
    '@taxora/tax-rules',
    '@taxora/accounting',
    '@taxora/rule-engine',
  ],

  webpack(config) {
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js':  ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
