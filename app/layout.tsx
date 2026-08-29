import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuoteMend — Automate305 revenue recovery",
  description:
    "Command center for the Automate305 sales engagement platform: today's follow-up queue, autopilot activity, and pipeline health.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
