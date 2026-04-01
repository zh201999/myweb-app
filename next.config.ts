import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["vis-network", "vis-data", "vis-util", "vis-peer-expression", "vis-expression-evaluator", "component-emitter"],
};

export default nextConfig;
