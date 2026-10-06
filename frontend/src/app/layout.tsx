import "@fontsource-variable/inter";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "WorldGraph",
  description:
    "What is changing in the world, why, what is likely next, and what it means for your business.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
