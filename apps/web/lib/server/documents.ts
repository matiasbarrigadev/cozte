import "server-only";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { normalizeName } from "@/lib/cozte-cost-view";
import type { Principal } from "./auth";
import { dbBatch, dbQuery } from "./db";
import { r2 } from "./r2";

export const DOCUMENT_MEDIA_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

/** The bytes must match the declared type: a PDF header or the image's magic number. */
export function hasValidSignature(bytes: Buffer, mediaType: string): boolean {
  if (mediaType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mediaType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

type StoreInput = { bytes: Buffer; filename: string; mediaType: string; origin: "upload" | "chat"; runId?: string; ordinal?: number };

/** Stores a private document in R2 and registers it; the object is removed again if the registry fails. */
export async function storeDocument(principal: Principal, input: StoreInput): Promise<string> {
  const { client, bucket } = r2();
  const documentId = crypto.randomUUID();
  const key = `${principal.organizationId}/${documentId}`;
  const filename = input.filename.replace(/[\r\n\t]+/g, " ").slice(0, 200) || "archivo";
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: input.bytes, ContentType: input.mediaType }));
  try {
    await dbBatch([
      { sql: "INSERT INTO source_documents (id, organization_id, object_key, filename, mime_type, byte_size, actor_id, origin, run_id, ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", params: [documentId, principal.organizationId, key, filename, input.mediaType, input.bytes.byteLength, principal.userId, input.origin, input.runId ?? null, input.ordinal ?? null] },
      { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, "upload-document", documentId, JSON.stringify({ filename, byteSize: input.bytes.byteLength, origin: input.origin })] },
    ]);
  } catch (error) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((cleanupError) => console.error("R2 orphan cleanup failed", cleanupError));
    throw error;
  }
  return documentId;
}

export type ChatAttachment = { ordinal: number; filename: string; documentId: string | null };

/**
 * Images and PDFs sent to Cozte are kept as documents so they can back the purchase or sale they show.
 * Storage problems never block the conversation: the file is still read by the model, just not kept.
 */
export async function storeChatAttachments(principal: Principal, runId: string, files: { filename?: string; mediaType: string; url: string }[]): Promise<ChatAttachment[]> {
  const stored: ChatAttachment[] = [];
  let ordinal = 0;
  for (const file of files) {
    ordinal += 1;
    const filename = file.filename || (file.mediaType.startsWith("image/") ? `imagen-${ordinal}` : `archivo-${ordinal}`);
    if (!DOCUMENT_MEDIA_TYPES.has(file.mediaType)) { stored.push({ ordinal, filename, documentId: null }); continue; }
    try {
      const bytes = Buffer.from(file.url.slice(file.url.indexOf(",") + 1), "base64");
      if (bytes.byteLength > MAX_DOCUMENT_BYTES || !hasValidSignature(bytes, file.mediaType)) { stored.push({ ordinal, filename, documentId: null }); continue; }
      stored.push({ ordinal, filename, documentId: await storeDocument(principal, { bytes, filename, mediaType: file.mediaType, origin: "chat", runId, ordinal }) });
    } catch (error) {
      console.error("Chat attachment was not kept as a document", error instanceof Error ? error.message : error);
      stored.push({ ordinal, filename, documentId: null });
    }
  }
  return stored;
}

/**
 * Finds the document a reference points to: its id, its number in the latest message with files ("1", "2"…)
 * or its file name. Returns null when nothing matches unambiguously.
 */
export async function resolveDocument(principal: Principal, reference: string): Promise<{ id: string; filename: string } | null> {
  const value = reference.trim();
  if (!value) return null;
  const rows = await dbQuery<{ id: string; filename: string; run_id: string | null; ordinal: number | null; origin: string }>(
    "SELECT id, filename, run_id, ordinal, origin FROM source_documents WHERE organization_id=? ORDER BY created_at DESC LIMIT 40",
    [principal.organizationId],
  );
  const byId = rows.find((row) => row.id === value);
  if (byId) return { id: byId.id, filename: byId.filename };
  const number = /^(?:archivo\s*|#)?(\d{1,2})$/i.exec(value)?.[1];
  if (number) {
    const latestRun = rows.find((row) => row.origin === "chat")?.run_id;
    const match = rows.find((row) => row.origin === "chat" && row.run_id === latestRun && row.ordinal === Number(number));
    return match ? { id: match.id, filename: match.filename } : null;
  }
  const key = normalizeName(value);
  const exact = rows.filter((row) => normalizeName(row.filename) === key);
  const partial = exact.length ? exact : rows.filter((row) => normalizeName(row.filename).includes(key));
  return partial[0] ? { id: partial[0].id, filename: partial[0].filename } : null;
}
