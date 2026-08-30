import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Heatwave 99",
  description:
    "A fast, original open-world boomer shooter set in Sunstroke County.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
