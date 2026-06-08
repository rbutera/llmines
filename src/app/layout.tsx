import "~/styles/globals.css";
import "~/styles/hud.css";

import { type Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";

import { AccountProvider } from "~/game/account/AccountProvider";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "LLMines",
  description: "A browser-based Lumines-like puzzle game",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

// JetBrains Mono is the cockpit-HUD voice (all readouts/titles/labels). Loaded
// via next/font so it is self-hosted (no runtime Google Fonts request) and
// exposed as `--font-jetbrains-mono`, which hud.css reads.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-jetbrains-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${jetbrainsMono.variable}`}>
      <body>
        <TRPCReactProvider>
          <AccountProvider>{children}</AccountProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
