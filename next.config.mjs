/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['./.next/server/**/*'],
    },
  },
};

export default nextConfig;
