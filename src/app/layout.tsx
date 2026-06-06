import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { AuthProvider } from "~/game/react/providers/AuthProvider";
import { ScoresProvider } from "~/game/react/providers/ScoresProvider";

export const metadata: Metadata = {
  title: "LLMines",
  description: "A browser-based Lumines-like puzzle game",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>
        <TRPCReactProvider>
          <AuthProvider>
            <ScoresProvider>{children}</ScoresProvider>
          </AuthProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
