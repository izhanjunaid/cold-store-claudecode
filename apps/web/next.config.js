/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server build for small production Docker images.
  // In this pnpm monorepo Next auto-detects the workspace root for file tracing.
  output: 'standalone',
  transpilePackages: ['@coldchain/shared', '@coldchain/ui'],
};

module.exports = nextConfig;
