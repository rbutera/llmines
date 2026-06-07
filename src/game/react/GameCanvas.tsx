"use client";

import type { GameController } from "../engine/controller";
import { ThreeRenderer } from "../render3d/ThreeRenderer";

/**
 * Mounts the Three.js / react-three-fiber renderer and wires it to the
 * controller. The `<Canvas>` is client-only (this file is "use client") and
 * subscribes to the controller via `controller.subscribe` inside the scene — the
 * same pure-consumer contract the old PixiRenderer used. The renderer swap (Pixi
 * -> R3F) touches no game logic and no test seam.
 */
export function GameCanvas({ controller }: { controller: GameController }) {
  return <ThreeRenderer controller={controller} />;
}
