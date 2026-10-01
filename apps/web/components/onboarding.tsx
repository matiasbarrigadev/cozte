"use client";

import * as React from "react";
import { toast } from "sonner";
import { supportedCurrencies, type Currency } from "@/lib/currency";
import { COUNTRIES, countryByCode, locationTimeZone } from "@/lib/locations";
import { firstName, type Onboarding } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CozteLogo } from "./cozte-logo";

export type OnboardingResult = { personName: string; companyName: string; country: string; currency: Currency };

type Level = "simple" | "medium" | "advanced";
const LEVELS: { id: Level; title: string; hint: string }[] = [
  { id: "simple", title: "Recién empiezo con los números", hint: "Te explico todo con ejemplos y vamos de a un paso." },
  { id: "medium", title: "Llevo cuentas pero quiero ordenarlas", hint: "Términos básicos explicados la primera vez." },
  { id: "advanced", title: "Manejo costos o soy contador", hint: "Directo al grano, con todas las secciones a mano." },
];
const STAGES: { selling: boolean; title: string; hint: string }[] = [
  { selling: true, title: "Sí, ya vendo", hint: "Ordenamos lo que ya pasa: tus costos, ventas y entregas reales." },
  { selling: false, title: "Todavía no, estoy armando un proyecto", hint: "Descubrimos juntos si cierra, con precios de mercado reales." },
];

/**
 * The first time a company opens Cozte: who is writing, what the company is called and where it is. Two short steps;
 * the country sets the main currency (still changeable here), the calendar and how Cozte talks. Then Cozte opens.
 */
export function OnboardingDialog({ start, currency: currentCurrency, onDone }: { start: Onboarding; currency: Currency; onDone: (result: OnboardingResult) => Promise<void> | void }) {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [level, setLevel] = React.useState<Level | null>(null);
  const [selling, setSelling] = React.useState<boolean | null>(null);
  const [personName, setPersonName] = React.useState(start.personName);
  const [companyName, setCompanyName] = React.useState(start.companyName);
  const [country, setCountry] = React.useState(start.country ?? "");
  const [city, setCity] = React.useState("");
  const [currency, setCurrency] = React.useState<Currency>(countryCurrency(start.country) ?? currentCurrency);
  const [busy, setBusy] = React.useState(false);
  const info = countryByCode(country);
  const zone = info ? locationTimeZone({ country }) : null;
  const localTime = zone ? new Intl.DateTimeFormat("es-AR", { timeZone: zone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()) : null;
  const namesReady = personName.trim().length >= 2 && companyName.trim().length >= 2;

  function chooseCountry(code: string) {
    setCountry(code);
    setCurrency(countryCurrency(code) ?? currency);
  }

  async function finish(event: React.FormEvent) {
    event.preventDefault();
    if (!info) { toast.error("Elige el país de tu empresa"); setStep(2); return; }
    if (!level || selling === null) return;
    setBusy(true);
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personName: personName.trim(), companyName: companyName.trim(), country, city: city.trim(), currency, level, selling }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudieron guardar los datos");
      await onDone(result as OnboardingResult);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron guardar los datos"); }
    finally { setBusy(false); }
  }

  // Stays open until the answers are saved: Escape and clicks outside do not close it.
  return <Dialog open onOpenChange={() => undefined}>
    <DialogContent showCloseButton={false} className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
      <div className="flex items-center justify-between gap-3"><CozteLogo className="text-xl" /><span className="text-xs text-muted-foreground tabular-nums">Paso {step} de 3</span></div>
      <div className="flex gap-1.5" aria-hidden="true">{[1, 2, 3].map((item) => <span key={item} className={item <= step ? "h-1 flex-1 rounded-full bg-primary" : "h-1 flex-1 rounded-full bg-muted"} />)}</div>
      {step === 1 ? <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); if (namesReady) setStep(2); }}>
        <DialogHeader>
          <DialogTitle className="text-xl">Te damos la bienvenida a Cozte</DialogTitle>
          <DialogDescription>Dos datos rápidos para empezar. Cozte los usa para hablarte por tu nombre y ordenar todo bajo tu empresa.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="onboarding-person">Tu nombre</FieldLabel><Input id="onboarding-person" value={personName} maxLength={80} autoComplete="name" autoFocus placeholder="Ej. Matías Pérez" onChange={(event) => setPersonName(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="onboarding-company">Nombre de tu empresa</FieldLabel><Input id="onboarding-company" value={companyName} maxLength={120} autoComplete="organization" placeholder="Ej. Tofu del Valle" onChange={(event) => setCompanyName(event.target.value)} /><FieldDescription>El nombre con que la conocen tus clientes. Se puede cambiar después.</FieldDescription></Field>
        </FieldGroup>
        <Button type="submit" size="lg" disabled={!namesReady}>Continuar</Button>
      </form> : step === 2 ? <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); if (info) setStep(3); }}>
        <DialogHeader>
          <DialogTitle className="text-xl">¿Dónde está {companyName.trim() || "tu empresa"}?</DialogTitle>
          <DialogDescription>Con el país, Cozte sabe tu moneda, tu día y tu hora, y te habla como se habla allá.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="onboarding-country">País</FieldLabel>
            <Dropdown id="onboarding-country" className="w-full" value={country} onChange={(event) => { if (event.target.value) chooseCountry(event.target.value); }}>
              <DropdownOption value="" disabled>Elegir país</DropdownOption>
              {COUNTRIES.map((item) => <DropdownOption key={item.code} value={item.code}>{item.name}</DropdownOption>)}
            </Dropdown>
          </Field>
          <Field><FieldLabel htmlFor="onboarding-city">Ciudad <span className="font-normal text-muted-foreground">(opcional)</span></FieldLabel><Input id="onboarding-city" value={city} maxLength={80} placeholder="Ej. Córdoba" onChange={(event) => setCity(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="onboarding-currency">Moneda principal</FieldLabel>
            <Dropdown id="onboarding-currency" className="w-full" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{supportedCurrencies.map((code) => <DropdownOption key={code} value={code}>{code}</DropdownOption>)}</Dropdown>
            <FieldDescription>{info ? `La de ${info.name}, salvo que elijas otra.` : "Sale del país."} Queda fija cuando cargues costos; cada insumo o gasto puede estar en otra moneda.</FieldDescription>
          </Field>
        </FieldGroup>
        {localTime ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">Allá es {localTime}.</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep(1)} disabled={busy}>Volver</Button>
          <Button type="submit" size="lg" disabled={!info}>Continuar</Button>
        </div>
      </form> : <form className="flex flex-col gap-5" onSubmit={finish}>
        <DialogHeader>
          <DialogTitle className="text-xl">Para arrancar por donde te sirve</DialogTitle>
          <DialogDescription>Con esto Cozte elige cómo explicarte y por dónde empezar. Se puede cambiar cuando quieras.</DialogDescription>
        </DialogHeader>
        <ChoiceGroup label="¿Cuánto sabés de costos?" options={LEVELS.map((item) => ({ key: item.id, title: item.title, hint: item.hint, selected: level === item.id, onSelect: () => setLevel(item.id) }))} />
        <ChoiceGroup label={`¿${companyName.trim() || "Tu empresa"} ya está vendiendo?`} options={STAGES.map((item) => ({ key: String(item.selling), title: item.title, hint: item.hint, selected: selling === item.selling, onSelect: () => setSelling(item.selling) }))} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep(2)} disabled={busy}>Volver</Button>
          <Button type="submit" size="lg" disabled={busy || !level || selling === null}>{busy ? "Guardando…" : `Empezar${firstName(personName) ? `, ${firstName(personName)}` : ""}`}</Button>
        </div>
      </form>}
    </DialogContent>
  </Dialog>;
}

/** One choice among a few, each with a line that says what it means. */
function ChoiceGroup({ label, options }: { label: string; options: { key: string; title: string; hint: string; selected: boolean; onSelect: () => void }[] }) {
  return <div className="flex flex-col gap-2" role="radiogroup" aria-label={label}>
    <p className="text-sm font-medium">{label}</p>
    {options.map((option) => <button key={option.key} type="button" role="radio" aria-checked={option.selected} aria-label={`${option.title}: ${option.hint}`} onClick={option.onSelect}
      className={cn("rounded-lg border p-3 text-left transition-colors", option.selected ? "border-foreground bg-muted/60 ring-1 ring-foreground" : "hover:bg-muted/40")}>
      <span className="block text-sm font-medium">{option.title}</span><span className="block text-xs text-muted-foreground">{option.hint}</span>
    </button>)}
  </div>;
}

function countryCurrency(code: string | null): Currency | null {
  const currency = countryByCode(code ?? "")?.currency;
  return currency && (supportedCurrencies as readonly string[]).includes(currency) ? currency : null;
}
