import type { Metadata } from "next";

import "./globals.css";

const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const metadataOrigin = vercelProductionHost
  ? `https://${vercelProductionHost}`
  : (process.env.WEBHOOK_URL ?? "http://localhost:3000");

export const metadata: Metadata = {
  description:
    "Monitor Automate305 outreach sequences, today’s send queue, sender capacity, and replies.",
  icons: {
    apple: "/apple-icon.png",
    icon: "/icon.png",
  },
  metadataBase: new URL(metadataOrigin),
  openGraph: {
    description: "The command center for Automate305 sales engagement.",
    images: [
      {
        alt: "OUTBOX — the Automate305 outbound command center",
        height: 630,
        url: "/opengraph-image",
        width: 1200,
      },
    ],
    title: "Automate305 OUTBOX",
    type: "website",
  },
  title: "Automate305 — OUTBOX",
  twitter: {
    card: "summary_large_image",
    description: "The command center for Automate305 sales engagement.",
    images: ["/opengraph-image"],
    title: "Automate305 OUTBOX",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
