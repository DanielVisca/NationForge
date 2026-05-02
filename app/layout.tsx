import type { Metadata } from "next";
import { Geist, Geist_Mono, Nunito } from "next/font/google";

import { DisplayPreferences } from "@/components/DisplayPreferences";
import { displayPrefsInlineBootScript } from "@/lib/display-prefs-boot";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const nunitoPlayful = Nunito({
  variable: "--font-playful",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Aetheria · Grok",
  description: "Chat with xAI Grok via the Responses API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${nunitoPlayful.variable} h-full antialiased`}
    >
      {/* displayPrefsInlineBootScript mutates <html> (dark class, data-*) before React hydrates */}
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{ __html: displayPrefsInlineBootScript() }}
        />
        {children}
        <DisplayPreferences />
      </body>
    </html>
  );
}
