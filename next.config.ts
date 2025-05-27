// next.config.ts
const nextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.1.2"],
  // ...other config options...
};

const configExport = async () => {
  const { default: withPWA } = await import("next-pwa");return withPWA({
    dest: "public",
    register: true,
    skipWaiting: true,
    disable: process.env.NODE_ENV === "development", // Disable only in development, enable in production
    sw: "sw.js",
  })(nextConfig);
};

export default configExport;
