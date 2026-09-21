import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { dbQuery } from "@/lib/server/db";
import { r2 } from "@/lib/server/r2";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await context.params;
    const [document] = await dbQuery<{ object_key: string; filename: string }>(
      "SELECT object_key, filename FROM source_documents WHERE id=? AND organization_id=?",
      [id, principal.organizationId],
    );
    if (!document) return Response.json({ error: "Documento no encontrado" }, { status: 404 });
    const { client, bucket } = r2();
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: document.object_key }), { expiresIn: 60 });
    return Response.json({ url, filename: document.filename }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiFailure(error); }
}
