import type { InputCommand } from "./types";

export function commandFromKey(key: string): InputCommand | null {
  switch (key) {
    case "h":
    case "ArrowLeft":
      return "left";
    case "l":
    case "ArrowRight":
      return "right";
    case "j":
    case "ArrowDown":
      return "softDrop";
    case "k":
    case "ArrowUp":
      return "rotate";
    case " ":
    case "Spacebar":
      return "hardDrop";
    default:
      return null;
  }
}
