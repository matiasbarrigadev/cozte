export const COZTE_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type CozteImageMediaType = (typeof COZTE_IMAGE_MEDIA_TYPES)[number];

export const COZTE_MAX_IMAGE_COUNT = 6;
export const COZTE_MAX_IMAGE_BYTES = 2_000_000;
export const COZTE_MAX_TOTAL_IMAGE_BYTES = 8_000_000;

const mediaTypeByExtension: Record<string, CozteImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function getCozteImageMediaType(file: Pick<File, "name" | "type">): CozteImageMediaType | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension && mediaTypeByExtension[extension]) return mediaTypeByExtension[extension];
  return COZTE_IMAGE_MEDIA_TYPES.find((mediaType) => mediaType === file.type) ?? null;
}
