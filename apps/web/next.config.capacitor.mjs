/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@zfloat/approvals",
    "@zfloat/audit",
    "@zfloat/auth",
    "@zfloat/config",
    "@zfloat/database",
    "@zfloat/etims",
    "@zfloat/ledger",
    "@zfloat/money",
    "@zfloat/notifications",
    "@zfloat/payments-core",
    "@zfloat/providers",
    "@zfloat/queue",
    "@zfloat/secrets",
    "@zfloat/validation",
  ],
  experimental: {
    serverComponentsExternalPackages: ["pg", "bullmq", "@valkey/valkey-glide"],
  },
  output: "export",
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Disable static generation for dynamic routes - they'll be handled at runtime
  // This requires all dynamic pages to have generateStaticParams or be marked as static
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@valkey/valkey-glide": "commonjs @valkey/valkey-glide",
        "@valkey/valkey-glide-linux-x64-gnu": "commonjs @valkey/valkey-glide-linux-x64-gnu",
      });
    }
    return config;
  },
};

export default nextConfig;