import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Audio uploads are large; the default action body limit is 1 MB.
    serverActions: { bodySizeLimit: "100mb" },
  },
};

export default nextConfig;
