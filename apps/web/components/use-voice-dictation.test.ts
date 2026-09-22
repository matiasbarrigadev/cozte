import { describe, expect, it } from "vitest";
import { waveformHeight } from "./use-voice-dictation";

describe("onda del micrófono", () => {
  it("permanece baja en silencio y sube con señal de audio", () => {
    const silence = new Uint8Array(64).fill(128);
    const sound = new Uint8Array(64).map((_, index) => index % 2 ? 170 : 86);
    expect(waveformHeight(silence, 0, 64)).toBeCloseTo(0.18);
    expect(waveformHeight(sound, 0, 64)).toBeGreaterThan(waveformHeight(silence, 0, 64));
  });
});
