import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Z-float — Business payments, controlled from one place",
  description:
    "Z-float is a Kenya-first business payment operations platform: disbursements, corporate bills, payroll, supplier payments, bulk airtime and approvals — controlled from one place.",
  keywords: ["M-Pesa", "business payments", "Kenya", "payroll", "bulk payments", "corporate bills", "Z-float"],
  applicationName: "Z-float",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Z-float",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F5BFF",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
