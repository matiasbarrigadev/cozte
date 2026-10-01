import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countryByCode } from "@/lib/locations";
import { formatMoney } from "@/lib/money";
import { ADMIN_VIEW_COOKIE, listOrganizations, superadminEmail } from "@/lib/server/platform-admin";
import { journeyMetrics, listJourneyDefinitions } from "@/lib/server/journey";
import { JourneyEditor } from "@/components/admin/journey-editor";

export const metadata: Metadata = { title: "Superadmin · Cozte", robots: { index: false, follow: false } };

const date = (value: string | null) => value ? new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.replace(" ", "T")}Z`)) : "—";

/** Cozte's superadmin panel: every organization, how much it uses Cozte, and a way into each one in read-only mode. */
export default async function AdminPage() {
  if (!process.env.CLERK_SECRET_KEY) notFound();
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  const email = await superadminEmail(session.userId);
  // To anyone else the panel does not exist.
  if (!email) notFound();
  const [organizations, viewing, journeys, metrics] = await Promise.all([listOrganizations(), cookies().then((store) => store.get(ADMIN_VIEW_COOKIE)?.value ?? null), listJourneyDefinitions(), journeyMetrics()]);
  const current = organizations.find((item) => item.id === viewing);

  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Superadmin · {email}</p><h1 className="text-3xl font-semibold tracking-tight">Empresas en Cozte</h1><p className="text-sm text-muted-foreground">Entra a cualquier empresa para ver sus datos en modo solo lectura. Cada acceso queda registrado.</p></div>
      <Link href="/app" className={buttonVariants({ variant: "outline" })}>Volver a mi empresa</Link>
    </div>
    {current ? <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle>Estás viendo {current.name}</CardTitle><CardDescription>Solo lectura: no puedes cambiar sus datos ni hablar con su Cozte.</CardDescription></div>
      <div className="flex gap-2"><Link href="/app" className={buttonVariants()}>Abrir</Link><form action="/api/admin/view" method="post"><input type="hidden" name="action" value="exit" /><Button type="submit" variant="outline">Salir</Button></form></div>
    </CardHeader></Card> : null}
    <Card>
      <CardHeader><CardTitle>{organizations.length} empresa{organizations.length === 1 ? "" : "s"}</CardTitle><CardDescription>La que tuvo actividad más reciente primero. Ventas de los últimos 30 días.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>Dónde</TableHead><TableHead className="text-right">Personas</TableHead><TableHead className="text-right">Productos</TableHead><TableHead className="text-right">Ventas 30 días</TableHead><TableHead>Última actividad</TableHead><TableHead>Creada</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{organizations.map((item) => <TableRow key={item.id}>
            <TableCell className="font-medium whitespace-normal">{item.name}{item.id === viewing ? <Badge variant="secondary" className="ml-2">Viendo</Badge> : null}<div className="text-xs font-normal text-muted-foreground">{item.currency}{item.lastAdminAccess ? ` · abierta por superadmin el ${date(item.lastAdminAccess)}` : ""}</div></TableCell>
            <TableCell className="whitespace-normal text-muted-foreground">{[item.city, countryByCode(item.country)?.name].filter(Boolean).join(", ") || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{item.members}</TableCell>
            <TableCell className="text-right tabular-nums">{item.products}</TableCell>
            <TableCell className="text-right tabular-nums">{item.sales30 ? <>{item.sales30}<div className="text-xs text-muted-foreground">{formatMoney(item.revenue30, item.currency)}</div></> : "—"}</TableCell>
            <TableCell className="text-muted-foreground">{date(item.lastActivity)}</TableCell>
            <TableCell className="text-muted-foreground">{date(item.createdAt)}</TableCell>
            <TableCell><form action="/api/admin/view" method="post"><input type="hidden" name="organizationId" value={item.id} /><Button type="submit" size="sm" variant={item.id === viewing ? "secondary" : "outline"}>Ver</Button></form></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Recorridos de descubrimiento</CardTitle><CardDescription>Las etapas que guían a cada empresa, por perfil. Se editan acá sin publicar una versión nueva; el avance de cada empresa se guarda por etapa.</CardDescription></CardHeader>
      <CardContent><JourneyEditor journeys={journeys.map((item) => ({ key: item.key, name: item.definition.name, stored: item.stored, error: item.error, json: item.json, stages: item.definition.stages.map((stage) => ({ id: stage.id, title: stage.title })) }))} metrics={metrics} /></CardContent>
    </Card>
  </main>;
}
