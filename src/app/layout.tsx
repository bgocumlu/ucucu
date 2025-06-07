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
        
        {/* iPhone X, XS, 11 Pro - 375x812 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1125-2436.jpg"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2436-1125.jpg"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone XR, 11 - 414x896 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-828-1792.jpg"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1792-828.jpg"
          media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPhone 12, 13 mini - 375x812 @3x (same as iPhone X) */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1125-2436.jpg"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2436-1125.jpg"
          media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 12, 13, 14 - 390x844 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1170-2532.jpg"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2532-1170.jpg"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 12 Pro Max, 13 Pro Max, 14 Plus - 428x926 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1284-2778.jpg"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2778-1284.jpg"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 14 Pro - 393x852 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1179-2556.jpg"
          media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2556-1179.jpg"
          media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 14 Pro Max - 430x932 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1290-2796.jpg"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2796-1290.jpg"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 15 Pro - 402x874 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1206-2622.jpg"
          media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2622-1206.jpg"
          media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 15 Pro Max - 440x956 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1320-2868.jpg"
          media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2868-1320.jpg"
          media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 6, 7, 8, SE 2nd/3rd gen - 375x667 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-750-1334.jpg"
          media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1334-750.jpg"
          media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPhone 6+, 7+, 8+ - 414x736 @3x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1242-2208.jpg"
          media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2208-1242.jpg"
          media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)"
        />
        
        {/* iPhone 5, 5s, 5c, SE 1st gen - 320x568 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-640-1136.jpg"
          media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1136-640.jpg"
          media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPad Mini, Air - 768x1024 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1536-2048.jpg"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2048-1536.jpg"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPad Air 10.9" - 820x1180 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1640-2360.jpg"
          media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2360-1640.jpg"
          media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPad Pro 11" - 834x1194 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-1668-2388.jpg"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2388-1668.jpg"
          media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
        />
        
        {/* iPad Pro 12.9" - 1024x1366 @2x */}
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2048-2732.jpg"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)"
        />
        <link 
          rel="apple-touch-startup-image" 
          href="/icons/apple-splash-2732-2048.jpg"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)"
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
