import { BACKING_TRACK_SRC, SWEEP_PERIOD_MS } from "./constants";
import { sweepXFromElapsedMs } from "./sweep";

export function createBackingAudio() {
  const audio = new Audio(BACKING_TRACK_SRC);
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("data-testid", "backing-audio");
  return audio;
}

export function sweepXFromAudio(audio: HTMLAudioElement | null) {
  if (!audio) return 0;
  return sweepXFromElapsedMs((audio.currentTime * 1000) % SWEEP_PERIOD_MS);
}
