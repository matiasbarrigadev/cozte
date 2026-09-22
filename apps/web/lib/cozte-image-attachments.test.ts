import { describe, expect, it } from "vitest";
import { COZTE_MAX_IMAGE_COUNT, COZTE_MAX_IMAGE_BYTES, COZTE_MAX_TOTAL_IMAGE_BYTES, getCozteImageMediaType } from "./cozte-image-attachments";

describe("Cozte image attachments", () => {
  it("accepts supported image MIME types and extensions", () => {
    expect(getCozteImageMediaType({ name: "photo.png", type: "" })).toBe("image/png");
    expect(getCozteImageMediaType({ name: "photo.JPG", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(getCozteImageMediaType({ name: "photo.webp", type: "" })).toBe("image/webp");
    expect(getCozteImageMediaType({ name: "clipboard-image", type: "image/jpeg" })).toBe("image/jpeg");
  });

  it("rejects formats not yet supported by this rollout", () => {
    expect(getCozteImageMediaType({ name: "document.pdf", type: "application/pdf" })).toBeNull();
    expect(getCozteImageMediaType({ name: "animation.gif", type: "image/gif" })).toBeNull();
  });

  it("keeps image upload limits explicit", () => {
    expect(COZTE_MAX_IMAGE_COUNT).toBe(6);
    expect(COZTE_MAX_IMAGE_BYTES).toBe(2_000_000);
    expect(COZTE_MAX_TOTAL_IMAGE_BYTES).toBe(8_000_000);
  });
});
