import type { NextConfig } from "next";
import path from 'path'

const nextConfig: NextConfig = {
  // Silence workspace root warning and ensure correct tracing in a monorepo
  outputFileTracingRoot: path.resolve(__dirname, '..'),
}

export default nextConfig;
