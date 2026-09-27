import type { CustomerDirectory } from "./business";
/**
 * Customers: one record per client with their addresses, and what they bought. Pure functions shared by the server
 * and the demo: name keys that join "Librería El Ateneo" and "libreria el ateneo", stats and a status in plain words.
 */

export type CustomerAddress = { id: string; label: string; address: string; zone: string; recipient: string; contact: string; notes: string; isDefault: boolean };

export type Customer = { id: string; name: string; phone: string; email: string; notes: string; source: "user" | "cozte" | "import"; createdAt: string; addresses: CustomerAddress[] };

/** The facts of a sale a customer's stats need. */
export type CustomerSale = {
  id: string; customerId: string | null; soldOn: string; channelName: string; items: string;
  totalMinor: number; variableCostMinor: number | null; sellingCostMinor: number; deliveryCostMinor: number;
  deliveryStatus?: string | null; deliveryAddress?: string | null;
};

export type CustomerStatus = "none" | "new" | "frequent" | "active" | "at-risk" | "inactive";

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  none: "Sin compras", new: "Nuevo", frequent: "Frecuente", active: "Activo", "at-risk": "En riesgo", inactive: "Inactivo",
};

export const CUSTOMER_STATUS_HINTS: Record<CustomerStatus, string> = {
  none: "Todavía no tiene ventas registradas",
  new: "Hizo su primera compra hace menos de un mes",
  frequent: "Compra seguido: tres compras o más y al día",
  active: "Compró en los últimos meses",
  "at-risk": "Tarda más que de costumbre en volver a comprar",
  inactive: "No compra hace más de cuatro meses",
};

export type CustomerStats = {
  sales: number; revenue: number;
  /** What the sales left after producing, selling and delivering; null when some sale had no complete cost. */
  left: number | null;
  firstOn: string | null; lastOn: string | null; averageTicket: number | null;
  /** Usual days between purchases, with two or more. */
  everyDays: number | null;
  daysSinceLast: number | null;
  status: CustomerStatus;
};

/** Lowercase, without accents, punctuation or extra spaces: the key that joins the same customer written differently. */
export function customerKey(name: string): string {
  return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The part of an address after its last comma, usually the city or neighborhood: a first guess of its zone. */
export function zoneFromAddress(address: string): string {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1].slice(0, 60) : "";
}

/** Whether a contact looks like a phone number. */
export const looksLikePhone = (contact: string) => contact.replace(/\D/g, "").length >= 6 && !/[a-z]{4,}/i.test(contact);

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export function customerStats(sales: CustomerSale[], today: string): CustomerStats {
  if (!sales.length) return { sales: 0, revenue: 0, left: null, firstOn: null, lastOn: null, averageTicket: null, everyDays: null, daysSinceLast: null, status: "none" };
  const dates = sales.map((sale) => sale.soldOn).sort();
  const revenue = sales.reduce((sum, sale) => sum + sale.totalMinor, 0);
  const complete = sales.every((sale) => sale.variableCostMinor !== null);
  const left = complete ? sales.reduce((sum, sale) => sum + sale.totalMinor - (sale.variableCostMinor ?? 0) - sale.sellingCostMinor - sale.deliveryCostMinor, 0) : null;
  const distinctDays = [...new Set(dates)];
  const everyDays = distinctDays.length >= 2 ? Math.round(days(distinctDays[0], distinctDays[distinctDays.length - 1]) / (distinctDays.length - 1)) : null;
  const lastOn = dates[dates.length - 1];
  const daysSinceLast = Math.max(0, days(lastOn, today));
  const status: CustomerStatus = daysSinceLast > 120 ? "inactive"
    : distinctDays.length >= 2 && everyDays && daysSinceLast > Math.max(everyDays * 1.8, 45) ? "at-risk"
    : distinctDays.length >= 3 ? "frequent"
    : distinctDays.length === 1 && daysSinceLast <= 30 ? "new"
    : "active";
  return { sales: sales.length, revenue: Math.round(revenue * 100) / 100, left: left === null ? null : Math.round(left * 100) / 100, firstOn: dates[0], lastOn, averageTicket: Math.round((revenue / sales.length) * 100) / 100, everyDays, daysSinceLast, status };
}

export type CustomerRow = Customer & { stats: CustomerStats };

/** Every customer with their stats, the one who bought most recently first (those without purchases last). */
export function buildCustomerList(customers: Customer[], sales: CustomerSale[], today: string): CustomerRow[] {
  const bySale = new Map<string, CustomerSale[]>();
  for (const sale of sales) if (sale.customerId) bySale.set(sale.customerId, [...(bySale.get(sale.customerId) ?? []), sale]);
  return customers.map((customer) => ({ ...customer, stats: customerStats(bySale.get(customer.id) ?? [], today) }))
    .sort((a, b) => (b.stats.lastOn ?? "").localeCompare(a.stats.lastOn ?? "") || a.name.localeCompare(b.name));
}

/** Purchases of each month, oldest first, for the customer's chart. */
export function customerMonths(sales: CustomerSale[], months: string[]): { month: string; revenue: number; sales: number }[] {
  return months.map((month) => {
    const inMonth = sales.filter((sale) => sale.soldOn.startsWith(month));
    return { month, revenue: Math.round(inMonth.reduce((sum, sale) => sum + sale.totalMinor, 0) * 100) / 100, sales: inMonth.length };
  });
}

/** How much of the revenue the largest customers bring: a concentration worth knowing. */
export function customerConcentration(rows: CustomerRow[]): { top: number; share: number } | null {
  const total = rows.reduce((sum, row) => sum + row.stats.revenue, 0);
  const buyers = rows.filter((row) => row.stats.revenue > 0).sort((a, b) => b.stats.revenue - a.stats.revenue);
  if (!total || buyers.length < 4) return null;
  const top = Math.min(3, buyers.length);
  return { top, share: buyers.slice(0, top).reduce((sum, row) => sum + row.stats.revenue, 0) / total };
}

export type ImportSource = { customer: string; soldOn: string; recipient?: string | null; address?: string | null; contact?: string | null };
export type ImportedCustomer = { key: string; name: string; phone: string; names: string[]; addresses: { address: string; zone: string; recipient: string; contact: string; isDefault: boolean }[] };

/**
 * Customers from the names already typed in sales and the addresses of their deliveries: the same name written
 * differently is one customer (the most recent spelling wins), each distinct address is kept, the latest as default.
 */
export function customersFromHistory(rows: ImportSource[]): ImportedCustomer[] {
  const byKey = new Map<string, ImportedCustomer & { addressKeys: Set<string> }>();
  for (const row of [...rows].sort((a, b) => b.soldOn.localeCompare(a.soldOn))) {
    const name = row.customer.trim();
    const key = customerKey(name);
    if (!key) continue;
    const entry = byKey.get(key) ?? { key, name, phone: "", names: [], addresses: [], addressKeys: new Set<string>() };
    if (!entry.names.includes(name)) entry.names.push(name);
    const contact = row.contact?.trim() ?? "";
    if (!entry.phone && contact && looksLikePhone(contact)) entry.phone = contact;
    const address = row.address?.trim() ?? "";
    const addressKey = customerKey(address);
    if (address && !entry.addressKeys.has(addressKey)) {
      entry.addressKeys.add(addressKey);
      const recipient = row.recipient?.trim() ?? "";
      entry.addresses.push({ address, zone: zoneFromAddress(address), recipient: recipient && customerKey(recipient) !== key ? recipient : "", contact, isDefault: entry.addresses.length === 0 });
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].map(({ addressKeys: _unused, ...entry }) => { void _unused; return entry; });
}

/** The suggestions for forms: each customer with their default address, plus the recipients, addresses and carriers typed before. */
export function directoryFromCustomers(rows: CustomerRow[], typed: CustomerDirectory): CustomerDirectory {
  const customers = rows.map((row) => {
    const main = row.addresses.find((address) => address.isDefault) ?? row.addresses[0];
    return { name: row.name, address: main?.address ?? "", contact: main?.contact || row.phone, recipient: main?.recipient ?? "", lastOn: row.stats.lastOn ?? row.createdAt.slice(0, 10), sales: row.stats.sales };
  });
  const addresses = [...new Set([...rows.flatMap((row) => row.addresses.map((address) => address.address)), ...typed.addresses])].slice(0, 400);
  return { customers, recipients: typed.recipients, addresses, carriers: typed.carriers };
}
