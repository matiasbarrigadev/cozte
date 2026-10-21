"use client";

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { customerKey } from "@/lib/customers";
import { AnimatedIcon } from "@/components/animated-icon";
import { Button } from "@/components/ui/button";

/** One of the company's records to pick: a customer, a supplier. */
export type PickerEntry = { key: string; name: string; hint?: string };

type Option = { kind: "entry"; entry: PickerEntry } | { kind: "create"; name: string } | { kind: "clear" };

const optionText = (option: Option) => option.kind === "entry" ? option.entry.name : option.kind === "create" ? option.name : "";

const MAX_SHOWN = 8;

/**
 * A record of the company, never free text: search and pick, or create a new one right there. A name that is not
 * picked is not used, so typos never become records. Shows the picked one with "Cambiar".
 */
export function EntityPicker({ entries, value, onPick, onCreate, noun, id, label, variant = "default", autoFocus, onCancel, onClear }: {
  entries: PickerEntry[];
  value: { name: string; hint?: string } | null;
  /** The picked entry's key; null when "Cambiar" lets go of the current one. */
  onPick: (key: string | null) => void;
  onCreate: (name: string) => void;
  /** What is picked, in the person's words: "cliente", "proveedor". */
  noun: string;
  id?: string; label?: string;
  /** A borderless field that fills a table cell, for correcting a record in place. */
  variant?: "default" | "cell"; autoFocus?: boolean;
  /** Leaving the field without picking (Escape or clicking away). */
  onCancel?: () => void;
  /** Offers "Sin …" to take it out. */
  onClear?: () => void;
}) {
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(Boolean(autoFocus));
  const inputRef = React.useRef<HTMLInputElement>(null);
  const picked = React.useRef(false);
  const query = customerKey(text);
  const exact = query ? entries.find((entry) => customerKey(entry.name) === query) : undefined;
  const options = React.useMemo<Option[]>(() => {
    const found = entries.filter((entry) => !query || customerKey(entry.name).includes(query)).slice(0, MAX_SHOWN).map((entry): Option => ({ kind: "entry", entry }));
    return [...found, ...(text.trim() && !exact ? [{ kind: "create", name: text.trim() } as const] : []), ...(onClear && !text.trim() ? [{ kind: "clear" } as const] : [])];
  }, [entries, query, text, exact, onClear]);
  const pick = (option: Option) => {
    picked.current = true;
    setOpen(false);
    setText("");
    if (option.kind === "entry") onPick(option.entry.key);
    else if (option.kind === "create") onCreate(option.name);
    else onClear?.();
  };

  if (value) {
    return <div className="flex min-h-9 items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{value.name}</p>
        {value.hint ? <p className="truncate text-[11px] text-muted-foreground">{value.hint}</p> : null}
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => { onPick(null); requestAnimationFrame(() => inputRef.current?.focus()); }} aria-label={`Cambiar el ${noun} ${value.name}`}>Cambiar</Button>
    </div>;
  }
  return <div className="flex flex-col gap-1">
    <Autocomplete.Root items={options} filteredItems={options} value={text} itemToStringValue={optionText}
      open={open && options.length > 0} onOpenChange={(next) => setOpen(next)}
      onValueChange={(next, details) => {
        if (details.reason === "escape-key") return;
        if (details.reason === "item-press") {
          const option = options.find((item) => optionText(item) === next);
          if (option) pick(option);
          return;
        }
        setText(next);
      }}>
      <Autocomplete.Input ref={inputRef} id={id} aria-label={label ?? noun} autoComplete="off" autoFocus={autoFocus} placeholder={variant === "cell" ? `Buscar o crear ${noun}` : `Buscar o crear ${noun} (opcional)`}
        onBlur={() => {
          setOpen(false);
          if (exact) { pick({ kind: "entry", entry: exact }); return; }
          // A pick from the list lands right after the field loses focus: give it a moment before leaving.
          if (onCancel) window.setTimeout(() => { if (!picked.current) onCancel(); }, 200);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) { event.preventDefault(); picked.current = true; onCancel(); return; }
          if (event.key === "Enter" && exact && !open) { event.preventDefault(); pick({ kind: "entry", entry: exact }); }
        }}
        className={variant === "cell"
          ? "h-11 w-full min-w-0 rounded-none border-0 bg-background px-3 text-sm shadow-none outline-none ring-2 ring-ring/50 placeholder:text-muted-foreground"
          : "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"} />
      {options.length ? <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="isolate z-50 outline-none">
          <Autocomplete.Popup className="max-h-[min(20rem,var(--available-height))] min-w-(--anchor-width) max-w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none">
            <Autocomplete.List>
              {(option: Option) => option.kind === "entry"
                ? <Autocomplete.Item key={option.entry.key} value={option} className="flex cursor-default flex-col rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
                  <span className="truncate">{option.entry.name}</span>
                  {option.entry.hint ? <span className="truncate text-xs text-muted-foreground">{option.entry.hint}</span> : null}
                </Autocomplete.Item>
                : option.kind === "create" ? <Autocomplete.Item key="create" value={option} className="flex cursor-default items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-primary outline-none select-none data-highlighted:bg-accent">
                  <AnimatedIcon name="plus" size={14} />Crear {noun} «{option.name}»
                </Autocomplete.Item>
                : <Autocomplete.Item key="clear" value={option} className="flex cursor-default items-center rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none select-none data-highlighted:bg-accent">Sin {noun}</Autocomplete.Item>}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal> : null}
    </Autocomplete.Root>
    {variant === "default" && text.trim() && !exact && !open ? <p className="text-[11px] text-muted-foreground">«{text.trim()}» no es un {noun} todavía. <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => pick({ kind: "create", name: text.trim() })}>Crearlo</button></p> : null}
  </div>;
}

/**
 * A table cell with a record (customer, supplier): shows it and, on click, the picker in place. Picking another,
 * leaving it without one or creating one (through `onCreate`) saves at once; Escape or clicking away keeps it.
 */
export function EntityCell({ value, entries, noun, label, onCommit, onCreate }: { value: string; entries: PickerEntry[]; noun: string; label: string; onCommit: (name: string) => void; onCreate: (name: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  return editing ? <EntityPicker variant="cell" autoFocus noun={noun} label={label} entries={entries} value={null}
    onPick={(key) => { setEditing(false); const entry = entries.find((item) => item.key === key); if (entry && entry.name !== value) onCommit(entry.name); }}
    onCreate={(name) => { setEditing(false); onCreate(name); }}
    onClear={value ? () => { setEditing(false); onCommit(""); } : undefined}
    onCancel={() => setEditing(false)} />
    : <button type="button" onClick={() => setEditing(true)} className="flex h-11 w-full items-center px-3 text-left text-sm hover:bg-accent/30" title={`Cambiar el ${noun}`} aria-label={`${value || `Sin ${noun}`}: cambiar el ${noun}`}>
      {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">Sin {noun}</span>}
    </button>;
}
