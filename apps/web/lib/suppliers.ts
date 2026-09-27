import type { PurchaseKind } from "./business";
import { customerKey } from "./customers";
import type { DeliveryTally } from "./delivery-zones";

/**
 * Suppliers: one record per supplier with what the business buys from each and how their prices moved. Pure functions
 * shared by the server and the demo: the import from names already typed, each supplier's stats and price history.
 */

export type SupplierKind = "materials" | "logistics" | "services" | "other";
export const SUPPLIER_KINDS: SupplierKind[] = ["materials", "logistics", "services", "other"];
export const SUPPLIER_KIND_LABELS: Record<SupplierKind, string> = { materials: "Insumos", logistics: "Envíos", services: "Servicios", other: "Otro" };
export const SUPPLIER_KIND_HINTS: Record<SupplierKind, string> = {
  materials: "Te vende lo que usas para producir",
  logistics: "Lleva tus pedidos: correo, transportista, mensajería",
  services: "Te cobra un servicio o un gasto: luz, alquiler, mantenimiento",
  other: "Cualquier otro",
};

export type Supplier = { id: string; name: string; kind: SupplierKind; contactName: string; phone: string; email: string; notes: string; source: "user" | "cozte" | "import"; createdAt: string };

/** A purchase as a supplier's stats read it. */
export type SupplierPurchase = {
  id: string; supplierId: string | null; purchasedOn: string; description: string; kind: PurchaseKind; amountMinor: number;
  materialId: string | null; materialName: string | null; quantityMilli: number | null; purchaseUnit?: string | null;
};

/** What a supply cost each time it was bought from a supplier, oldest first. */
export type MaterialPrice = { materialId: string; name: string; unit: string; points: { on: string; unitPrice: number }[]; first: number; last: number; lastOn: string; change: number | null };

export type SupplierStats = {
  purchases: number;
  /** Spent in the last 12 months. */
  spent: number;
  firstOn: string | null; lastOn: string | null;
  /** Usual days between purchases, with two or more on different days. */
  everyDays: number | null;
  daysSinceLast: number | null;
};

export type SupplierRow = Supplier & {
  stats: SupplierStats;
  /** Supplies it sells: bought from it or with it as their usual supplier. */
  materials: string[];
  prices: MaterialPrice[];
  /** Delivery zones it serves and how its deliveries went in the last months (logistics). */
  zones: string[];
  deliveries: DeliveryTally | null;
};

/** The same key customers use: "Papelería Sur" and "papeleria sur" are one supplier. */
export const supplierKey = customerKey;

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const monthsBefore = (today: string, count: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - count); return date.toISOString().slice(0, 10); };

export function supplierStats(purchases: Pick<SupplierPurchase, "purchasedOn" | "amountMinor">[], today: string): SupplierStats {
  if (!purchases.length) return { purchases: 0, spent: 0, firstOn: null, lastOn: null, everyDays: null, daysSinceLast: null };
  const dates = [...new Set(purchases.map((item) => item.purchasedOn))].sort();
  const since = monthsBefore(today, 12);
  const firstOn = dates[0], lastOn = dates[dates.length - 1];
  return {
    purchases: purchases.length,
    spent: Math.round(purchases.filter((item) => item.purchasedOn > since).reduce((sum, item) => sum + item.amountMinor, 0)),
    firstOn, lastOn,
    everyDays: dates.length >= 2 ? Math.round(days(firstOn, lastOn) / (dates.length - 1)) : null,
    daysSinceLast: days(lastOn, today),
  };
}

/** Each supply's price per purchase unit every time it was bought (with its quantity), oldest first. */
export function materialPrices(purchases: SupplierPurchase[]): MaterialPrice[] {
  const bySupply = new Map<string, MaterialPrice>();
  for (const purchase of [...purchases].sort((a, b) => a.purchasedOn.localeCompare(b.purchasedOn))) {
    if (!purchase.materialId || !purchase.quantityMilli || purchase.quantityMilli <= 0) continue;
    const unitPrice = Math.round(purchase.amountMinor / (purchase.quantityMilli / 1000));
    const entry = bySupply.get(purchase.materialId) ?? { materialId: purchase.materialId, name: purchase.materialName ?? purchase.description, unit: purchase.purchaseUnit ?? "", points: [], first: unitPrice, last: unitPrice, lastOn: purchase.purchasedOn, change: null };
    entry.points.push({ on: purchase.purchasedOn, unitPrice });
    entry.last = unitPrice;
    entry.lastOn = purchase.purchasedOn;
    entry.change = entry.points.length >= 2 && entry.first > 0 ? (entry.last - entry.first) / entry.first : null;
    bySupply.set(purchase.materialId, entry);
  }
  return [...bySupply.values()].sort((a, b) => b.lastOn.localeCompare(a.lastOn) || a.name.localeCompare(b.name, "es"));
}

/** What was bought from a supplier in each month. */
export function supplierMonths(purchases: Pick<SupplierPurchase, "purchasedOn" | "amountMinor">[], months: string[]) {
  return months.map((month) => {
    const list = purchases.filter((item) => item.purchasedOn.startsWith(month));
    return { month, amount: Math.round(list.reduce((sum, item) => sum + item.amountMinor, 0)), purchases: list.length };
  });
}

/** Suppliers most spent with first; then the most recent. */
export function sortSuppliers<T extends { name: string; stats: SupplierStats }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.stats.spent - a.stats.spent || (b.stats.lastOn ?? "").localeCompare(a.stats.lastOn ?? "") || a.name.localeCompare(b.name, "es"));
}

const KIND_ORDER: SupplierKind[] = ["materials", "logistics", "services", "other"];

/**
 * The suppliers in the names already typed (purchases, supplies and carriers): the same name written differently is
 * one supplier, named as it was written most recently. Selling supplies wins over the other kinds.
 */
export function suppliersFromHistory(rows: { name: string; kind: SupplierKind; on?: string | null }[]): { key: string; name: string; kind: SupplierKind; names: string[] }[] {
  const found = new Map<string, { key: string; name: string; on: string; kind: SupplierKind; names: Set<string> }>();
  for (const row of rows) {
    const name = row.name.trim();
    const key = supplierKey(name);
    if (!key) continue;
    const on = row.on ?? "";
    const entry = found.get(key) ?? { key, name, on, kind: row.kind, names: new Set<string>() };
    entry.names.add(row.name);
    if (on > entry.on) { entry.on = on; entry.name = name; }
    if (KIND_ORDER.indexOf(row.kind) < KIND_ORDER.indexOf(entry.kind)) entry.kind = row.kind;
    found.set(key, entry);
  }
  return [...found.values()].map((entry) => ({ key: entry.key, name: entry.name.slice(0, 120), kind: entry.kind, names: [...entry.names] }));
}

/** The kind of supplier a purchase suggests. */
export const kindForPurchase = (kind: PurchaseKind): SupplierKind => kind === "material" ? "materials" : "services";

export type SupplierInsight = { tone: "good" | "bad" | "info"; text: string };

/**
 * What stands out across suppliers, in plain words: supplies whose price rose or fell the most, supplies bought from a
 * single supplier, and how much of the spending goes to one supplier.
 */
export function supplierInsights(rows: SupplierRow[], money: (value: number) => string): SupplierInsight[] {
  const insights: SupplierInsight[] = [];
  const moves = rows.flatMap((row) => row.prices.filter((price) => price.change !== null).map((price) => ({ supplier: row.name, price })))
    .sort((a, b) => Math.abs(b.price.change!) - Math.abs(a.price.change!));
  const rise = moves.find((move) => move.price.change! >= 0.05);
  if (rise) insights.push({ tone: "bad", text: `${rise.price.name} con ${rise.supplier} subió ${Math.round(rise.price.change! * 100)} %: de ${money(rise.price.first)} a ${money(rise.price.last)}${rise.price.unit ? ` por ${rise.price.unit}` : ""}.` });
  const drop = moves.find((move) => move.price.change! <= -0.05);
  if (drop) insights.push({ tone: "good", text: `${drop.price.name} con ${drop.supplier} bajó ${Math.round(-drop.price.change! * 100)} %.` });
  const sellers = new Map<string, Set<string>>();
  for (const row of rows) for (const name of row.materials) sellers.set(supplierKey(name), new Set([...(sellers.get(supplierKey(name)) ?? []), row.id]));
  const single = rows.filter((row) => row.kind === "materials").flatMap((row) => row.materials.filter((name) => sellers.get(supplierKey(name))?.size === 1).map((name) => ({ name, supplier: row.name })));
  if (single.length) insights.push({ tone: "info", text: `${single.slice(0, 3).map((item) => item.name).join(", ")}${single.length > 3 ? ` y ${single.length - 3} más` : ""} ${single.length === 1 ? "se compra" : "se compran"} a un solo proveedor: conviene tener otro a mano por si falta o sube.` });
  const total = rows.reduce((sum, row) => sum + row.stats.spent, 0);
  const top = sortSuppliers(rows)[0];
  if (top && total > 0 && rows.filter((row) => row.stats.spent > 0).length >= 3 && top.stats.spent / total >= 0.4) insights.push({ tone: "info", text: `${top.name} se lleva el ${Math.round((top.stats.spent / total) * 100)} % de lo que compras (${money(top.stats.spent)} en el año).` });
  return insights;
}
