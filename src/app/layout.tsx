import type { Metadata } from "next";
import "./globals.css";
import "@/components/operator-tools.css";
import "@/components/mail.css";
export const metadata: Metadata = {
  title: "Liam Concierge · A little more ease",
  description:
    "Liam Concierge: a package concierge demonstration for nFactorial.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
