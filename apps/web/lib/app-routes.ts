/** Sections of the workspace and their URLs under /app. */
export type AppView = "dashboard" | "producto" | "planilla" | "ventas" | "gastos" | "compras" | "resultado" | "analisis" | "asistente" | "historial" | "presentaciones" | "presentacion";

const segments: Record<Exclude<AppView, "producto" | "presentacion">, string> = {
  dashboard: "",
  planilla: "costos",
  ventas: "ventas",
  gastos: "gastos",
  compras: "compras",
  resultado: "resultado",
  analisis: "analisis",
  asistente: "cozte",
  historial: "historial",
  presentaciones: "presentaciones",
};

export function appPath(view: AppView, productId?: string | null): string {
  if (view === "producto") return productId ? `/app/productos/${encodeURIComponent(productId)}` : "/app";
  if (view === "presentacion") return productId ? `/app/presentaciones/${encodeURIComponent(productId)}` : "/app/presentaciones";
  return segments[view] ? `/app/${segments[view]}` : "/app";
}

/** Reads the section from the path segments after /app; null when the path is not a known section. */
export function viewFromSegments(parts: string[] = []): { view: AppView; productId?: string } | null {
  if (!parts.length) return { view: "dashboard" };
  if (parts[0] === "productos" && parts[1] && parts.length === 2) return { view: "producto", productId: decodeURIComponent(parts[1]) };
  if (parts[0] === "presentaciones" && parts[1] && parts.length === 2) return { view: "presentacion", productId: decodeURIComponent(parts[1]) };
  if (parts.length !== 1) return null;
  const view = (Object.entries(segments) as [AppView, string][]).find(([, segment]) => segment && segment === parts[0])?.[0];
  return view ? { view } : null;
}

export function viewFromPathname(pathname: string): { view: AppView; productId?: string } | null {
  const match = /^\/app(?:\/(.*))?$/.exec(pathname.replace(/\/+$/, ""));
  return match ? viewFromSegments(match[1] ? match[1].split("/") : []) : null;
}
