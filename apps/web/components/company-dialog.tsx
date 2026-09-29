"use client";

import * as React from "react";
import { toast } from "sonner";
import { supportedCurrencies, type Currency } from "@/lib/currency";
import type { DomainState } from "@/lib/domain";
import { COUNTRIES, countryByCode, locationTimeZone } from "@/lib/locations";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * The company: its name (owners change it here, and in the account too) and where it is. Its country sets the business's day and time, how Cozte talks (vos, tú or usted, and the
 * local words) and the currency it suggests; the main currency can change only before costs are loaded.
 */
export function CompanyDialog({ open, onClose, state, demo, canRename = false, onSaved }: { open: boolean; onClose: () => void; state: DomainState; demo: boolean; canRename?: boolean; onSaved: () => Promise<void> | void }) {
  const organization = state.organization;
  const savedName = organization.name === "Mi empresa" ? "" : organization.name;
  const [name, setName] = React.useState(savedName);
  const currencyLocked = state.products.length > 0 || state.materials.length > 0 || state.expenses.length > 0;
  const [country, setCountry] = React.useState(organization.country ?? "");
  const [city, setCity] = React.useState(organization.city ?? "");
  const [timeZone, setTimeZone] = React.useState(organization.timeZone ?? "");
  const [currency, setCurrency] = React.useState<Currency>(organization.currency);
  const [busy, setBusy] = React.useState(false);
  const info = countryByCode(country);
  const zone = info ? locationTimeZone({ country, timeZone }) : null;
  const localTime = zone ? new Intl.DateTimeFormat("es-AR", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()) : null;

  function chooseCountry(code: string) {
    const next = countryByCode(code);
    setCountry(code);
    setTimeZone(next?.timeZones[0]?.zone ?? "");
    // Until costs are loaded, the main currency follows the country (it can still be changed).
    if (next && !currencyLocked && (supportedCurrencies as readonly string[]).includes(next.currency)) setCurrency(next.currency);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (demo) { toast.info("Demostración: los cambios no se guardan"); return; }
    if (!info) { toast.error("Elige el país de tu empresa"); return; }
    setBusy(true);
    try {
      if (canRename && name.trim() && name.trim() !== savedName) {
        const renamed = await fetch("/api/organization/name", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        const data = await renamed.json();
        if (!renamed.ok) throw new Error(data.error ?? "No se pudo cambiar el nombre");
      }
      const response = await fetch("/api/organization/location", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ country, city, timeZone: zone }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar la ubicación");
      if (!currencyLocked && currency !== organization.currency) {
        const changed = await fetch("/api/organization/currency", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ currency, expectedRevision: state.revision }) });
        const data = await changed.json();
        if (!changed.ok) throw new Error(data.error ?? "La ubicación quedó guardada, pero no se pudo cambiar la moneda");
      }
      await onSaved();
      toast.success(`Listo: ${name.trim() && canRename ? `${name.trim()} · ` : ""}${city ? `${city}, ` : ""}${info.name}`);
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); }
    finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{canRename ? "Tu empresa" : "¿Dónde está tu empresa?"}</DialogTitle>
        <DialogDescription>Con el país, Cozte usa el día y la hora de allá, te habla como se habla ahí y te sugiere la moneda. No cambia ningún costo.</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <FieldGroup>
          {canRename ? <Field><FieldLabel htmlFor="company-name">Nombre</FieldLabel><Input id="company-name" value={name} maxLength={120} autoComplete="organization" placeholder="Ej. Tofu del Valle" onChange={(event) => setName(event.target.value)} /></Field> : null}
          <Field><FieldLabel htmlFor="company-country">País</FieldLabel>
            <Dropdown id="company-country" className="w-full" value={country} onChange={(event) => { if (event.target.value) chooseCountry(event.target.value); }}>
              <DropdownOption value="" disabled>Elegir país</DropdownOption>
              {COUNTRIES.map((item) => <DropdownOption key={item.code} value={item.code}>{item.name}</DropdownOption>)}
            </Dropdown>
          </Field>
          <Field><FieldLabel htmlFor="company-city">Ciudad</FieldLabel><Input id="company-city" value={city} maxLength={80} placeholder="Ej. Córdoba" onChange={(event) => setCity(event.target.value)} /></Field>
          {info && info.timeZones.length > 1 ? <Field><FieldLabel htmlFor="company-zone">Zona horaria</FieldLabel>
            <Dropdown id="company-zone" className="w-full" value={zone ?? undefined} onChange={(event) => setTimeZone(event.target.value)}>
              {info.timeZones.map((item) => <DropdownOption key={item.zone} value={item.zone}>{item.label}</DropdownOption>)}
            </Dropdown>
          </Field> : null}
          <Field><FieldLabel htmlFor="company-currency">Moneda principal</FieldLabel>
            {currencyLocked
              ? <p id="company-currency" className="text-sm"><span className="font-medium">{organization.currency}</span> <span className="text-muted-foreground">· queda fija porque ya hay costos cargados. Cada insumo o gasto puede estar en otra moneda.</span></p>
              : <Dropdown id="company-currency" className="w-full" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{supportedCurrencies.map((code) => <DropdownOption key={code} value={code}>{code}</DropdownOption>)}</Dropdown>}
            {!currencyLocked ? <FieldDescription>Se elige antes de cargar costos y después queda fija. Los costos pueden estar en otras monedas.</FieldDescription> : null}
          </Field>
        </FieldGroup>
        {localTime ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">Allá es {localTime}.</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{organization.country ? "Cancelar" : "Más tarde"}</Button>
          <Button type="submit" disabled={busy || !info}>{busy ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
