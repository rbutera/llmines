import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIN,
  nextSkin,
  skinById,
  SKIN_NEON,
  SKIN_PIPELINE,
  SKINS,
} from "./skins";

describe("skin registry", () => {
  it("ships exactly the two skins in cycle order", () => {
    expect(SKINS.map((s) => s.id)).toEqual(["neon", "pipeline"]);
  });
  it("defaults to neon", () => {
    expect(DEFAULT_SKIN.id).toBe("neon");
  });
  it("every skin carries a track", () => {
    for (const s of SKINS) expect(typeof s.track.base).toBe("string");
  });
  it("neon plays song1 flat under /audio; pipeline plays song2", () => {
    expect(SKIN_NEON.track.base).toBe("/audio");
    expect(SKIN_PIPELINE.track.base).toBe("/audio/song2");
    expect(SKIN_PIPELINE.track.id).toBe("pipeline");
  });
});

describe("nextSkin cycles", () => {
  it("neon -> pipeline -> neon", () => {
    expect(nextSkin("neon").id).toBe("pipeline");
    expect(nextSkin("pipeline").id).toBe("neon");
  });
  it("unknown id falls back to the first cycle step", () => {
    expect(nextSkin("nope").id).toBe("neon");
  });
});

describe("skinById", () => {
  it("resolves known ids", () => {
    expect(skinById("pipeline")).toBe(SKIN_PIPELINE);
  });
  it("defaults unknown / null to neon", () => {
    expect(skinById("nope")).toBe(SKIN_NEON);
    expect(skinById(null)).toBe(SKIN_NEON);
  });
});

describe("tempo is the single source (matches the audio manifest)", () => {
  // Read the live manifest from disk so a re-cut that changes a song's tempo
  // forces the matching Skin.tempo to be updated in lock step (or this fails).
  const manifestPath = fileURLToPath(
    new URL("../../../public/audio/manifest.json", import.meta.url),
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    songs: { id: string; tempo: number }[];
  };
  const tempoForSong = (id: string): number => {
    const song = manifest.songs.find((s) => s.id === id);
    if (!song) throw new Error(`manifest has no song ${id}`);
    return song.tempo;
  };
  // The skin -> manifest-song mapping (by the track's asset base): neon plays
  // song1 flat under /audio, pipeline plays song2 under /audio/song2.
  const SONG_FOR_SKIN: Record<string, string> = {
    neon: "song1",
    pipeline: "song2",
  };

  it("each skin's tempo equals its track's manifest tempo", () => {
    for (const s of SKINS) {
      const songId = SONG_FOR_SKIN[s.id];
      expect(songId, `no manifest mapping for skin ${s.id}`).toBeTruthy();
      expect(s.tempo).toBeCloseTo(tempoForSong(songId!), 3);
    }
  });

  it("the two skins have distinct tempos (a real sweep-speed difference)", () => {
    expect(SKIN_NEON.tempo).not.toBeCloseTo(SKIN_PIPELINE.tempo, 1);
  });
});

describe("palette cohesion", () => {
  it("the two skins have distinct accents (a real recolour)", () => {
    expect(SKIN_NEON.board.darkEmissive).not.toBe(
      SKIN_PIPELINE.board.darkEmissive,
    );
    expect(SKIN_NEON.chrome.accent).not.toBe(SKIN_PIPELINE.chrome.accent);
  });
  it("the neon skin matches the round-2 baked-in board palette", () => {
    // Guards P0: switching back to neon must reproduce the exact dark-surround
    // tuning the round-2 visual shipped (so the skin layer can never regress it).
    expect(SKIN_NEON.board.darkFace).toBe("#1a0e33");
    expect(SKIN_NEON.board.darkEmissive).toBe("#3b1d6e");
    expect(SKIN_NEON.board.darkCore).toBe("#2a1147");
    expect(SKIN_NEON.board.darkCoreEmissive).toBe("#7c3aed");
    expect(SKIN_NEON.board.background).toBe("#0a0a12");
  });
});
