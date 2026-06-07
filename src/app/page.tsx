import GameApp from "~/app/_game/GameApp";

// Root route mounts the LLMines game (Req 1.1, 11.1). GameApp is a client
// component; this server component simply renders it.
export default function Home() {
  return <GameApp />;
}
