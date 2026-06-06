"use client";

import dynamic from "next/dynamic";

const Game = dynamic(() => import("~/components/Game").then((m) => m.Game), {
  ssr: false,
});

export default function Home() {
  return <Game />;
}
