import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WebSocketProvider } from "@/components/WebSocketProvider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ucucu",
  description: "Create and join ephemeral chat rooms instantly. Real-time messaging with notification bells, global rooms, and temporary conversations that disappear when empty. No registration required.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {  return (
    <html lang="en">
      <head>
        {/* Apple PWA Meta Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Ucucu" />
        
        {/* Apple Touch Icon */}
        <link rel="apple-touch-icon" href="/icons/apple-icon-180.png" />
        
        {/* Apple Splash Screens */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        {/* iPad */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPhone 16 Pro */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 16 Pro Max */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* Generic fallbacks for unmatched devices */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-portrait.png"
          media="(orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-landscape.png"
          media="(orientation: landscape)"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ServiceWorkerRegistration />
        <WebSocketProvider>{children}</WebSocketProvider>
      </body>
    </html>
  );
}
