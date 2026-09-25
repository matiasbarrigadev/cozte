import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { dbQuery } from "@/lib/server/db";
import { DOCUMENT_MEDIA_TYPES, MAX_DOCUMENT_BYTES, hasValidSignature, storeDocument } from "@/lib/server/documents";

export const runtime = "nodejs";

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

/** Uploads a receipt or delivery note (PDF or image up to 4 MB) and returns its id to attach it to a record. */
export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal(true);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_DOCUMENT_BYTES + 100_000) return Response.json({ error: "El archivo supera 4 MB" }, { status: 413 });
    const body = await request.formData();
    const file = body.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_DOCUMENT_BYTES || !DOCUMENT_MEDIA_TYPES.has(file.type)) return Response.json({ error: "Adjunta un PDF o imagen de hasta 4 MB" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasValidSignature(bytes, file.type)) return Response.json({ error: "El contenido no coincide con el tipo de archivo" }, { status: 400 });
    const id = await storeDocument(principal, { bytes, filename: file.name, mediaType: file.type, origin: "upload" });
    return Response.json({ id, filename: file.name }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}
