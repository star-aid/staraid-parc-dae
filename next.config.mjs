/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Une page déjà visitée est réaffichée depuis le cache du navigateur pendant
    // 60 s (pages dynamiques) au lieu d'être re-rendue par le serveur à chaque retour.
    staleTimes: { dynamic: 60, static: 300 },
    outputFileTracingIncludes: {
      '/**': ['./.next/server/**/*'],
    },
  },
};

export default nextConfig;
