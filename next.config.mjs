/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["papaparse", "pdf-parse", "pdfjs-dist"],
  },
};

export default nextConfig;
