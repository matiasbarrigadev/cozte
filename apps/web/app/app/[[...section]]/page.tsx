import { CreateOrganization, OrganizationSwitcher } from "@clerk/nextjs";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { CostosApp } from "@/components/costos-app";
import { loadDashboard } from "@/lib/server/state";
import { sessionPrincipal } from "@/lib/server/auth";
import { superadminEmail } from "@/lib/server/platform-admin";
import { viewFromSegments } from "@/lib/app-routes";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Every workspace section has its own URL (/app, /app/costos, /app/analisis, /app/productos/:id…). */
export default async function AppPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  // Comprobantes was retired from the workspace; old links land on the dashboard.
  if (section?.length === 1 && section[0] === "comprobantes") redirect("/app");
  if (!viewFromSegments(section)) notFound();
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center p-6">
      <Card className="w-full">
        <CardHeader><CardTitle>Cozte está preparando el acceso</CardTitle><CardDescription>Mientras activamos el ingreso de empresas, puedes explorar cómo funciona el costeo multiproducto.</CardDescription></CardHeader>
        <CardContent><Link href="/demo" className={buttonVariants()}>Explorar demostración</Link></CardContent>
      </Card>
    </main>
  );
  const { userId, principal } = await sessionPrincipal();
  if (!userId) redirect("/sign-in");
  // A superadmin without a company of their own still gets to the panel of every company.
  const superadmin = Boolean(await superadminEmail(userId).catch(() => null));
  if (!principal) return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full">
        <CardHeader><CardTitle>Tu empresa</CardTitle><CardDescription>Crea o selecciona una empresa para comenzar a costear.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrganizationSwitcher hidePersonal />
          <CreateOrganization afterCreateOrganizationUrl="/app" />
          <Button variant="outline" render={<Link href="/demo" />} nativeButton={false}>Ver una demostración</Button>
          {superadmin ? <Button variant="outline" render={<Link href="/admin" />} nativeButton={false}>Panel de superadmin</Button> : null}
        </CardContent>
      </Card>
    </main>
  );
  let initial;
  try {
    initial = await loadDashboard(principal);
  } catch {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center p-6">
        <Card className="w-full">
          <CardHeader><CardTitle>Conexión de datos pendiente</CardTitle><CardDescription>La cuenta está lista, pero falta conectar el puente privado de D1.</CardDescription></CardHeader>
          <CardContent><Button render={<Link href="/demo" />} nativeButton={false}>Ver demostración</Button></CardContent>
        </Card>
      </main>
    );
  }
  return <CostosApp initial={initial} initialSection={section} adminView={Boolean(principal.adminView)} superadmin={superadmin} />;
}
