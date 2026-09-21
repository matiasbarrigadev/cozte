import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { dbBatch, dbQuery } from "@/lib/server/db";
import { r2 } from "@/lib/server/r2";

export const runtime = "nodejs";
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function GET() {
  try {
    const principal = await requirePrincipal();
    const documents = await dbQuery<{ id: string; filename: string; mime_type: string; byte_size: number; created_at: string }>(
      "SELECT id, filename, mime_type, byte_size, created_at FROM source_documents WHERE organization_id=? ORDER BY created_at DESC LIMIT 50",
      [principal.organizationId],
    );
    return Response.json({ documents }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_SIZE + 100_000) return Response.json({ error: "El archivo supera 4 MB" }, { status: 413 });
    const body = await request.formData();
    const file = body.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_FILE_SIZE || !allowedTypes.has(file.type)) return Response.json({ error: "Adjunta un PDF o imagen de hasta 4 MB" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const validSignature = file.type === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
      : file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : file.type === "image/jpeg" ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!validSignature) return Response.json({ error: "El contenido no coincide con el tipo de archivo" }, { status: 400 });
    const { client, bucket } = r2();
    const documentId = crypto.randomUUID();
    const key = `${principal.organizationId}/${documentId}`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: file.type }));
    try {
      await dbBatch([
        { sql: "INSERT INTO source_documents (id, organization_id, object_key, filename, mime_type, byte_size, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)", params: [documentId, principal.organizationId, key, file.name.slice(0, 200), file.type, file.size, principal.userId] },
        { sql: "INSERT INTO audit_events (id, organization_id, actor_id, action, entity_id, details_json) VALUES (?, ?, ?, ?, ?, ?)", params: [crypto.randomUUID(), principal.organizationId, principal.userId, "upload-document", documentId, JSON.stringify({ filename: file.name.slice(0, 200), byteSize: file.size })] },
      ]);
    } catch (error) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch((cleanupError) => console.error("R2 orphan cleanup failed", cleanupError));
      throw error;
    }
    return Response.json({ id: documentId, filename: file.name }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}
