"use client";

import * as React from "react";
import { toast } from "sonner";
import { SUPPLIER_KINDS, SUPPLIER_KIND_HINTS, SUPPLIER_KIND_LABELS, type SupplierKind, type SupplierRow } from "@/lib/suppliers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { businessAction, notifySaved } from "./business-ui";
import { EntityCell, EntityPicker, type PickerEntry } from "./entity-picker";

/** A supplier as the picker needs it: who, what kind and what it sells. */
export type SupplierEntry = Pick<SupplierRow, "id" | "name" | "kind"> & { materials?: string[]; phone?: string };

const hintOf = (supplier: SupplierEntry) => [SUPPLIER_KIND_LABELS[supplier.kind], supplier.materials?.slice(0, 3).join(", ")].filter(Boolean).join(" · ");
const toEntry = (supplier: SupplierEntry): PickerEntry => ({ key: supplier.id, name: supplier.name, hint: hintOf(supplier) });

/**
 * The supplier of a purchase, always one of the company's suppliers: search and pick, or create one right there with
 * its kind. A name that is not picked is not used, so typos never become suppliers.
 */
export function SupplierPicker({ suppliers, value, onChange, onCreate, id, label = "Proveedor" }: { suppliers: SupplierEntry[]; value: SupplierEntry | null; onChange: (supplier: SupplierEntry | null) => void; onCreate: (name: string) => void; id?: string; label?: string }) {
  const entries = React.useMemo(() => suppliers.map(toEntry), [suppliers]);
  return <EntityPicker noun="proveedor" id={id} label={label} entries={entries} onCreate={onCreate}
    value={value ? { name: value.name, hint: hintOf(value) } : null}
    onPick={(key) => onChange(key === null ? null : suppliers.find((supplier) => supplier.id === key) ?? null)} />;
}

/** The supplier cell of the purchases table: the picker in place, with a quick creation; saves at once. */
export function SupplierCell({ value, suppliers, kind, demo, onCommit, onSupplierCreated }: { value: string; suppliers: SupplierEntry[]; kind: SupplierKind; demo: boolean; onCommit: (name: string) => void; onSupplierCreated?: (supplier: SupplierEntry) => void }) {
  const [creating, setCreating] = React.useState<string | null>(null);
  const entries = React.useMemo(() => suppliers.map(toEntry), [suppliers]);
  return <>
    <EntityCell value={value} entries={entries} noun="proveedor" label="Proveedor de la compra" onCommit={onCommit} onCreate={setCreating} />
    {creating !== null ? <QuickSupplierDialog name={creating} kind={kind} demo={demo} onClose={() => setCreating(null)}
      onCreated={(supplier) => { setCreating(null); onSupplierCreated?.(supplier); onCommit(supplier.name); }} /> : null}
  </>;
}

/** Creates a supplier from the purchase being made, with its kind and contact, and hands it back to link it. */
export function QuickSupplierDialog({ name, kind: initialKind, demo, onClose, onCreated }: { name: string; kind: SupplierKind; demo: boolean; onClose: () => void; onCreated: (supplier: SupplierEntry) => void }) {
  const [supplierName, setSupplierName] = React.useState(name);
  const [kind, setKind] = React.useState<SupplierKind>(initialKind);
  const [contactName, setContactName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supplierName.trim()) return;
    setBusy(true);
    try {
      const saved = await businessAction<{ id: string }>({ action: "save-supplier", supplier: { name: supplierName.trim(), kind, contactName: contactName.trim(), phone: phone.trim() } }, demo);
      notifySaved(`Proveedor creado: ${supplierName.trim()}`);
      onCreated({ id: saved.id, name: supplierName.trim(), kind, materials: [], phone: phone.trim() });
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear el proveedor"); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Proveedor nuevo</DialogTitle><DialogDescription>Queda en tus proveedores y ligado a esta compra, con su historial de precios.</DialogDescription></DialogHeader>
    <form className="flex flex-col gap-4" onSubmit={submit}><FieldGroup>
      <Field><FieldLabel htmlFor="quick-supplier-name">Nombre</FieldLabel><Input id="quick-supplier-name" value={supplierName} onChange={(event) => setSupplierName(event.target.value)} required maxLength={120} autoFocus /></Field>
      <Field><FieldLabel>Qué te vende</FieldLabel>
        <div role="radiogroup" aria-label="Qué te vende" className="flex flex-wrap gap-1.5">
          {SUPPLIER_KINDS.map((item) => <button key={item} type="button" role="radio" aria-checked={kind === item} onClick={() => setKind(item)}
            className={cn("rounded-full border px-3 py-1 text-xs transition-colors", kind === item ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{SUPPLIER_KIND_LABELS[item]}</button>)}
        </div>
        <FieldDescription>{SUPPLIER_KIND_HINTS[kind]}.</FieldDescription></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor="quick-supplier-contact">Contacto</FieldLabel><Input id="quick-supplier-contact" value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={120} placeholder="Opcional" /></Field>
        <Field><FieldLabel htmlFor="quick-supplier-phone">Teléfono</FieldLabel><Input id="quick-supplier-phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" maxLength={60} placeholder="Opcional" /></Field>
      </div>
    </FieldGroup>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={busy || !supplierName.trim()}>{busy ? "Creando…" : "Crear proveedor"}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
