"use client";

import type { Product } from "@/lib/domain";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { supportedCurrencies } from "@/lib/currency";

type Kind = "product" | "material" | "expense" | "edit-product" | null;

export function EntityDialog({ kind, product, products, onClose, onSave, currency, busy, demo }: {
  kind: Kind;
  product?: Product;
  products: Product[];
  onClose: () => void;
  onSave: (action: Record<string, unknown>) => Promise<boolean>;
  currency: string;
  busy: boolean;
  demo: boolean;
}) {
  if (!kind) return null;
  const title = kind === "material" ? "Nuevo insumo" : kind === "expense" ? "Nuevo gasto compartido" : kind === "edit-product" ? "Editar producto" : "Nuevo producto";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const integer = (key: string) => Math.trunc(Number(data.get(key) ?? 0));
    let action: Record<string, unknown>;
    if (kind === "material") action = {
      action: "create-material", name: String(data.get("name") ?? "").trim(), supplier: String(data.get("supplier") ?? "").trim(),
      purchaseUnit: String(data.get("purchaseUnit") ?? "").trim(), category: String(data.get("category") ?? "Materia prima").trim(), price: data.get("price") === "" ? undefined : Number(data.get("price")), currency: String(data.get("currency") ?? currency),
      source: String(data.get("source") ?? "").trim(),
    };
    else if (kind === "expense") action = {
      action: "create-expense", name: String(data.get("name") ?? "").trim(), period: String(data.get("period") ?? ""),
      amount: Number(data.get("amount")), currency: String(data.get("currency") ?? currency), allocationBasis: String(data.get("allocationBasis") ?? "hours"), category: String(data.get("category") ?? "Gastos generales").trim(),
      source: String(data.get("source") ?? "").trim(),
    };
    else action = {
      action: kind === "edit-product" ? "update-product" : "create-product",
      ...(kind === "edit-product" ? { id: product?.id } : { cloneProductId: String(data.get("cloneProductId") ?? "") || undefined }),
      name: String(data.get("name") ?? "").trim(), lotUnits: integer("lotUnits"), salePriceMinor: integer("salePriceMinor"),
      salesVariableMinor: integer("salesVariableMinor"), laborLotMinor: integer("laborLotMinor"),
      productionHoursMilli: Math.round(Number(data.get("productionHours") ?? 0) * 1000),
    };
    if (await onSave(action)) onClose();
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{kind === "product" ? "Puedes copiar la composición de otra variante sin duplicar sus precios." : kind === "expense" ? "Se repartirá entre los productos según la base elegida." : `Importes en ${currency}.`}</DialogDescription></DialogHeader>
    <form key={`${kind}-${product?.id ?? ""}`} className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
      {kind === "material" ? <FieldGroup>
        <Field><FieldLabel htmlFor="material-name">Insumo</FieldLabel><Input id="material-name" name="name" required minLength={2} placeholder="Ej. Papel interior" /></Field>
        <Field><FieldLabel htmlFor="supplier">Proveedor</FieldLabel><Input id="supplier" name="supplier" placeholder="Opcional" /></Field>
        <Field><FieldLabel htmlFor="material-category">Categoría</FieldLabel><Input id="material-category" name="category" defaultValue="Materia prima" minLength={2} maxLength={40} required /></Field>
        <Field><FieldLabel htmlFor="purchase-unit">Unidad de compra</FieldLabel><Input id="purchase-unit" name="purchaseUnit" required minLength={2} placeholder="Ej. resma, kg, unidad" /></Field>
        <div className="grid grid-cols-[1fr_auto] gap-3"><Field><FieldLabel htmlFor="material-price">Precio vigente</FieldLabel><Input id="material-price" name="price" type="number" min="0" step="0.001" placeholder="Puedes dejarlo vacío" /></Field><Field><FieldLabel htmlFor="material-currency">Moneda</FieldLabel><NativeSelect id="material-currency" name="currency" defaultValue={currency}>{supportedCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect></Field></div>
        <Field><FieldLabel htmlFor="material-source">Fuente</FieldLabel><Input id="material-source" name="source" placeholder="Factura o cotización" /></Field>
      </FieldGroup> : null}
      {kind === "expense" ? <FieldGroup>
        <Field><FieldLabel htmlFor="expense-name">Gasto</FieldLabel><Input id="expense-name" name="name" required minLength={2} placeholder="Ej. Electricidad" /></Field>
        <Field><FieldLabel htmlFor="expense-category">Categoría</FieldLabel><Input id="expense-category" name="category" defaultValue="Gastos generales" minLength={2} maxLength={40} required /></Field>
        <Field><FieldLabel htmlFor="expense-period">Período</FieldLabel><Input id="expense-period" name="period" type="month" required defaultValue={new Date().toISOString().slice(0, 7)} /></Field>
        <div className="grid grid-cols-[1fr_auto] gap-3"><Field><FieldLabel htmlFor="expense-amount">Importe</FieldLabel><Input id="expense-amount" name="amount" type="number" min="0" step="0.001" required /></Field><Field><FieldLabel htmlFor="expense-currency">Moneda</FieldLabel><NativeSelect id="expense-currency" name="currency" defaultValue={currency}>{supportedCurrencies.map((code) => <NativeSelectOption key={code} value={code}>{code}</NativeSelectOption>)}</NativeSelect></Field></div>
        <Field><FieldLabel htmlFor="allocation-basis">Base de reparto</FieldLabel><NativeSelect id="allocation-basis" name="allocationBasis" className="w-full"><NativeSelectOption value="hours">Horas de producción</NativeSelectOption><NativeSelectOption value="units">Unidades del lote</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="expense-source">Fuente</FieldLabel><Input id="expense-source" name="source" required minLength={2} placeholder="Ej. Factura de septiembre" /></Field>
      </FieldGroup> : null}
      {kind === "product" || kind === "edit-product" ? <FieldGroup>
        {kind === "product" ? <Field><FieldLabel htmlFor="clone-product">Copiar composición de</FieldLabel><NativeSelect id="clone-product" name="cloneProductId" className="w-full"><NativeSelectOption value="">Empezar vacío</NativeSelectOption>{products.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}</NativeSelect></Field> : null}
        <Field><FieldLabel htmlFor="product-name">Producto</FieldLabel><Input id="product-name" name="name" required minLength={2} defaultValue={product?.name} placeholder="Ej. Cuaderno A5 · tapa dura" /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="lot-units">Unidades por lote</FieldLabel><Input id="lot-units" name="lotUnits" type="number" min="1" required defaultValue={product?.lotUnits ?? 100} /></Field><Field><FieldLabel htmlFor="sale-price">Precio de venta ({currency})</FieldLabel><Input id="sale-price" name="salePriceMinor" type="number" min="0" required defaultValue={product?.salePriceMinor ?? 0} /></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field><FieldLabel htmlFor="sales-variable">Venta variable por unidad</FieldLabel><Input id="sales-variable" name="salesVariableMinor" type="number" min="0" defaultValue={product?.salesVariableMinor ?? 0} /></Field><Field><FieldLabel htmlFor="labor-lot">Trabajo directo por lote</FieldLabel><Input id="labor-lot" name="laborLotMinor" type="number" min="0" defaultValue={product?.laborLotMinor ?? 0} /></Field></div>
        <Field><FieldLabel htmlFor="production-hours">Horas de producción por lote</FieldLabel><Input id="production-hours" name="productionHours" type="number" min="0" step="0.001" defaultValue={(product?.productionHoursMilli ?? 0) / 1000} /></Field>
      </FieldGroup> : null}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || demo}>{kind === "edit-product" ? "Guardar producto" : "Crear"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
