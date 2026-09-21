import { auth } from "@clerk/nextjs/server";
import { CreateOrganization, OrganizationSwitcher } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CostosApp } from "@/components/costos-app";
import { loadDashboard } from "@/lib/server/state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Home() {
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  if (!session.orgId) return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full">
        <CardHeader><CardTitle>Tu empresa</CardTitle><CardDescription>Crea o selecciona una empresa para comenzar a costear.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrganizationSwitcher hidePersonal />
          <CreateOrganization afterCreateOrganizationUrl="/" />
          <Button variant="outline" render={<Link href="/demo" />} nativeButton={false}>Ver una demostración</Button>
        </CardContent>
      </Card>
    </main>
  );
  let initial;
  try {
    initial = await loadDashboard({
      userId: session.userId,
      organizationId: session.orgId,
      role: session.orgRole === "org:admin" ? "owner" : session.orgRole === "org:member" ? "editor" : "viewer",
    });
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
  return <CostosApp initial={initial} />;
}
