import type { NextConfig } from "next";

const isCloudflareStaticExport =
  process.env.CLOUDFLARE_STATIC_EXPORT === "1";

const nextConfig: NextConfig = isCloudflareStaticExport
  ? { output: "export" }
  : {};

export default nextConfig;
