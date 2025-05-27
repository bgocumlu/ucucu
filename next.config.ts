// next.config.ts
const nextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.1.2"],
  // ...other config options...
};

const isDev = process.env.NODE_ENV === "development";

const configExport = async () => {
  const { default: withPWA } = await import("next-pwa");
  return withPWA({
    dest: "public",
    register: true,
    skipWaiting: true,
    disable: true, // Disable PWA service worker completely to avoid conflicts
    sw: "sw.js",
  })(nextConfig);
};

export default configExport;
