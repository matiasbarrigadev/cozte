"use client";

import * as React from "react";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DocumentRow = { id: string; filename: string; mime_type: string; byte_size: number; created_at: string };

export function EvidencePanel({ demo }: { demo: boolean }) {
  const [documents, setDocuments] = React.useState<DocumentRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<File | null>(null);

  React.useEffect(() => {
    if (demo) return;
    let active = true;
    fetch("/api/documents", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (active) setDocuments(data.documents ?? []); }).catch(() => {});
    return () => { active = false; };
  }, [demo]);

  async function upload() {
    if (!selected || demo) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", selected);
      const response = await fetch("/api/documents", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo subir el archivo");
      toast.success("Comprobante guardado");
      setSelected(null);
      const listing = await fetch("/api/documents", { cache: "no-store" });
      if (listing.ok) setDocuments((await listing.json()).documents ?? []);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo subir el archivo"); }
    finally { setBusy(false); }
  }

  async function openDocument(id: string) {
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo abrir");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo abrir"); }
  }

  return <Card><CardHeader><CardTitle>Comprobantes</CardTitle><CardDescription>Documentos privados para respaldar precios y gastos.</CardDescription></CardHeader><CardContent className="flex flex-col gap-5">
    <FieldGroup><Field><FieldLabel htmlFor="evidence-file">PDF o imagen (máximo 4 MB)</FieldLabel><Input id="evidence-file" type="file" accept=".pdf,image/png,image/jpeg,image/webp" disabled={demo || busy} onChange={(event) => setSelected(event.target.files?.[0] ?? null)} /></Field></FieldGroup>
    {documents.length ? <Table><TableHeader><TableRow><TableHead>Archivo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Tamaño</TableHead></TableRow></TableHeader><TableBody>{documents.map((item) => <TableRow key={item.id}><TableCell><Button variant="link" onClick={() => void openDocument(item.id)}><FileText data-icon="inline-start" />{item.filename}</Button></TableCell><TableCell>{new Date(item.created_at).toLocaleDateString("es-CL")}</TableCell><TableCell className="text-right">{Math.round(item.byte_size / 1024)} KB</TableCell></TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><FileText /></EmptyMedia><EmptyTitle>Sin comprobantes</EmptyTitle><EmptyDescription>Adjunta una factura o cotización para respaldar el próximo cambio.</EmptyDescription></EmptyHeader></Empty>}
  </CardContent><CardFooter><Button variant="outline" disabled={!selected || busy || demo} onClick={() => void upload()}><Upload data-icon="inline-start" />Subir comprobante</Button></CardFooter></Card>;
}
