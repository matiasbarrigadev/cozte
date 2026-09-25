/**
 * Visuals Cozte can show in the chat and pin to the board next to it. They always render live engine data,
 * so a chart can never show a number the model made up.
 */
export type WidgetKind = "unit-cost" | "cost-breakdown" | "channels" | "month" | "sales" | "cost-evolution" | "purchases";

export const WIDGET_KINDS: WidgetKind[] = ["unit-cost", "cost-breakdown", "channels", "month", "sales", "cost-evolution", "purchases"];

export const WIDGETS: Record<WidgetKind, { label: string; hint: string; needsProduct?: boolean }> = {
  "unit-cost": { label: "Costo por unidad", hint: "El costo de cada producto y en qué se va, al momento" },
  "cost-breakdown": { label: "Desglose de un producto", hint: "Cada insumo, la mano de obra y los gastos de una unidad", needsProduct: true },
  channels: { label: "Te queda por canal", hint: "Lo que deja cada unidad en cada canal de venta" },
  month: { label: "Tu mes", hint: "Resultado del mes y cuánto falta para no perder" },
  sales: { label: "Ventas del mes", hint: "Lo vendido por canal y por día" },
  "cost-evolution": { label: "Evolución de costos", hint: "Cómo cambió el costo por unidad en el tiempo" },
  purchases: { label: "Últimas compras", hint: "Compras e inversiones recientes con su tipo" },
};

export type BoardWidget = { id: string; kind: WidgetKind; productId?: string | null; addedBy: "user" | "cozte" };

export const MAX_BOARD_WIDGETS = 8;

export const isWidgetKind = (value: unknown): value is WidgetKind => typeof value === "string" && (WIDGET_KINDS as string[]).includes(value);

/** Reads a stored board defensively, keeping known widgets only. */
export function parseBoard(value: unknown): BoardWidget[] {
  let data = value;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return []; } }
  if (!Array.isArray(data)) return [];
  return data.flatMap((item): BoardWidget[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (!isWidgetKind(entry.kind) || typeof entry.id !== "string") return [];
    return [{ id: entry.id, kind: entry.kind, productId: typeof entry.productId === "string" ? entry.productId : null, addedBy: entry.addedBy === "cozte" ? "cozte" : "user" }];
  }).slice(0, MAX_BOARD_WIDGETS);
}

/** Adds a widget at the top; the same visual (kind and product) is moved instead of duplicated. */
export function pinWidget(board: BoardWidget[], widget: Omit<BoardWidget, "id">): BoardWidget[] {
  const same = (item: BoardWidget) => item.kind === widget.kind && (item.productId ?? null) === (widget.productId ?? null);
  const existing = board.find(same);
  return [{ ...widget, id: existing?.id ?? `${widget.kind}-${Math.random().toString(36).slice(2, 10)}` }, ...board.filter((item) => !same(item))].slice(0, MAX_BOARD_WIDGETS);
}
