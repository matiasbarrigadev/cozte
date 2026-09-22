import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES,
  COZTE_MAX_ATTACHMENT_COUNT,
  COZTE_MAX_IMAGE_BYTES,
  COZTE_MAX_IMAGE_COUNT,
  COZTE_MAX_PDF_BYTES,
  COZTE_MAX_SPREADSHEET_COUNT,
  COZTE_MAX_SPREADSHEET_BYTES,
  COZTE_MAX_TOTAL_ATTACHMENT_BYTES,
  COZTE_MAX_TOTAL_IMAGE_BYTES,
  getCozteAttachmentKind,
  getCozteAttachmentMediaType,
  prepareCozteModelMessages,
} from "./cozte-assistant-attachments";

describe("Cozte assistant attachments", () => {
  it("normalizes image, PDF, and XLSX MIME types", () => {
    expect(getCozteAttachmentMediaType({ name: "photo.png", type: "" })).toBe("image/png");
    expect(getCozteAttachmentMediaType({ name: "photo.JPG", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(getCozteAttachmentMediaType({ name: "scan.pdf", type: "" })).toBe("application/pdf");
    expect(getCozteAttachmentMediaType({ name: "costs.xlsx", type: "application/octet-stream" })).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(getCozteAttachmentMediaType({ name: "fake.pdf", type: "image/png" })).toBeNull();
    expect(getCozteAttachmentKind({ name: "clipboard-image", type: "image/webp" })).toBe("image");
  });

  it("rejects unsupported file formats", () => {
    expect(getCozteAttachmentMediaType({ name: "legacy.xls", type: "application/vnd.ms-excel" })).toBeNull();
    expect(getCozteAttachmentMediaType({ name: "animation.gif", type: "image/gif" })).toBeNull();
    expect(COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES).toHaveLength(5);
  });

  it("keeps upload limits explicit", () => {
    expect(COZTE_MAX_IMAGE_COUNT).toBe(6);
    expect(COZTE_MAX_ATTACHMENT_COUNT).toBe(8);
    expect(COZTE_MAX_IMAGE_BYTES).toBe(2_000_000);
    expect(COZTE_MAX_TOTAL_IMAGE_BYTES).toBe(8_000_000);
    expect(COZTE_MAX_PDF_BYTES).toBe(5_000_000);
    expect(COZTE_MAX_SPREADSHEET_COUNT).toBe(3);
    expect(COZTE_MAX_SPREADSHEET_BYTES).toBe(1_000_000);
    expect(COZTE_MAX_TOTAL_ATTACHMENT_BYTES).toBe(12_000_000);
  });

  it("sends PDF parts to the model but uses extracted Excel text instead of XLSX binaries", () => {
    const messages = [{ role: "user", content: [
      { type: "text", text: "Revisa estos archivos." },
      { type: "file", data: "data:application/pdf;base64,JVBERi0x", mediaType: "application/pdf" },
      { type: "file", data: "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,UEsDBA==", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ] }] satisfies ModelMessage[];

    const [prepared] = prepareCozteModelMessages(messages);

    expect(prepared?.role).toBe("user");
    expect(prepared?.content).toEqual([
      { type: "text", text: "Revisa estos archivos." },
      { type: "file", data: "data:application/pdf;base64,JVBERi0x", mediaType: "application/pdf" },
    ]);
  });
});
