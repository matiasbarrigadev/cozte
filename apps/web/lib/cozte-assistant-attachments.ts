import type { ModelMessage } from "ai";

export const COZTE_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type CozteImageMediaType = (typeof COZTE_IMAGE_MEDIA_TYPES)[number];
export const COZTE_SPREADSHEET_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
export const COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES = [...COZTE_IMAGE_MEDIA_TYPES, "application/pdf", COZTE_SPREADSHEET_MEDIA_TYPE] as const;
export type CozteAssistantAttachmentMediaType = (typeof COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES)[number];
export type CozteAssistantAttachmentKind = "image" | "pdf" | "spreadsheet";

export const COZTE_MAX_IMAGE_COUNT = 6;
export const COZTE_MAX_IMAGE_BYTES = 2_000_000;
export const COZTE_MAX_TOTAL_IMAGE_BYTES = 8_000_000;
export const COZTE_MAX_ATTACHMENT_COUNT = 8;
export const COZTE_MAX_PDF_BYTES = 5_000_000;
export const COZTE_MAX_SPREADSHEET_BYTES = 1_000_000;
export const COZTE_MAX_SPREADSHEET_COUNT = 3;
export const COZTE_MAX_TOTAL_ATTACHMENT_BYTES = 12_000_000;

const mediaTypeByExtension: Record<string, CozteAssistantAttachmentMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  xlsx: COZTE_SPREADSHEET_MEDIA_TYPE,
};

export function getCozteAttachmentMediaType(file: Pick<File, "name" | "type">): CozteAssistantAttachmentMediaType | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const extensionMediaType = extension ? mediaTypeByExtension[extension] : undefined;
  const declaredMediaType = COZTE_ASSISTANT_ATTACHMENT_MEDIA_TYPES.find((mediaType) => mediaType === file.type);
  if (declaredMediaType && extensionMediaType && declaredMediaType !== extensionMediaType) return null;
  return declaredMediaType ?? extensionMediaType ?? null;
}

export function getCozteAttachmentKind(file: Pick<File, "name" | "type">): CozteAssistantAttachmentKind | null {
  const mediaType = getCozteAttachmentMediaType(file);
  if (mediaType && COZTE_IMAGE_MEDIA_TYPES.includes(mediaType as CozteImageMediaType)) return "image";
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType === COZTE_SPREADSHEET_MEDIA_TYPE) return "spreadsheet";
  return null;
}

export function getCozteAttachmentMaxBytes(kind: CozteAssistantAttachmentKind): number {
  if (kind === "image") return COZTE_MAX_IMAGE_BYTES;
  if (kind === "pdf") return COZTE_MAX_PDF_BYTES;
  return COZTE_MAX_SPREADSHEET_BYTES;
}

export function prepareCozteModelMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) return message;
    return { ...message, content: message.content.filter((part) => !(part.type === "file" && part.mediaType === COZTE_SPREADSHEET_MEDIA_TYPE)) };
  });
}
