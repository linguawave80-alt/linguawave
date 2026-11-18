/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The backend still redirects to the old static URLs (e.g. /pages/dashboard.html).
  // Map them to the new routes so no backend change is required.
  async redirects() {
    return [
      { source: '/pages/dashboard.html', destination: '/dashboard', permanent: false },
      { source: '/index.html', destination: '/', permanent: false },
      { source: '/reset-password.html', destination: '/reset-password', permanent: false },
    ];
  },
};
export default nextConfig;
