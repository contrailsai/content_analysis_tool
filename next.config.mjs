/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [{ source: "/upload", destination: "/run-analysis", permanent: false }];
  },
};

export default nextConfig;
