import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>
        <TRPCReactProvider>
          <AccountProvider>{children}</AccountProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
