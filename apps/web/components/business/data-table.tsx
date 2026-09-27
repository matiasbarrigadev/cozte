"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, Search, X } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
import { SuggestInput, type Suggestion } from "@/components/ui/suggest-input";
import { Input } from "@/components/ui/input";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Pieces for the editable, filterable tables of the business sections: cells that save on Enter or when leaving
 * them (Escape cancels), sortable headers and a search-and-filter bar.
 */

export const sheetCell = "border-r border-b border-border p-0 last:border-r-0 align-middle";
export const sheetHead = "h-10 border-b border-r border-border bg-muted/60 px-3 text-xs font-medium text-muted-foreground last:border-r-0 whitespace-nowrap";
const cellInput = "h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-3 shadow-none transition-colors hover:bg-accent/30 focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:bg-transparent disabled:opacity-100";

type CommitProps<T> = { value: T; label: string; onCommit: (value: T) => void; disabled?: boolean; className?: string; placeholder?: string };

function useCommitHandlers(reset: (input: HTMLInputElement) => void, commit: (input: HTMLInputElement) => void) {
  return {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { reset(event.currentTarget); event.currentTarget.blur(); }
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => commit(event.currentTarget),
  };
}

export function EditableText({ value, label, onCommit, disabled, className, placeholder }: CommitProps<string>) {
  const handlers = useCommitHandlers((input) => { input.value = value; }, (input) => {
    const next = input.value.trim();
    if (next !== value) onCommit(next);
  });
  return <Input key={value} defaultValue={value} aria-label={label} title={value || undefined} placeholder={placeholder} disabled={disabled} className={cn(cellInput, className)} {...handlers} />;
}

/** A number cell; empty or invalid input goes back to the saved value. */
export function EditableNumber({ value, label, onCommit, disabled, className, min = 0, step = "any", placeholder }: Omit<CommitProps<number | null>, "onCommit"> & { onCommit: (value: number) => void; min?: number; step?: string }) {
  const handlers = useCommitHandlers((input) => { input.value = value === null ? "" : String(value); }, (input) => {
    const raw = input.value.trim();
    const next = Number(raw.replace(",", "."));
    if (!raw || !Number.isFinite(next) || next < min) { input.value = value === null ? "" : String(value); return; }
    if (next !== value) onCommit(next);
  });
  return <Input key={value ?? "empty"} type="number" inputMode="decimal" min={min} step={step} defaultValue={value ?? ""} aria-label={label} placeholder={placeholder} disabled={disabled}
    className={cn(cellInput, "text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none", className)} {...handlers} />;
}

/** A date cell: picking a day in the calendar saves it. */
export function EditableDate({ value, label, onCommit, disabled, className, today }: CommitProps<string> & { today?: string }) {
  return <DatePicker variant="cell" value={value} aria-label={label} disabled={disabled} today={today} className={className}
    onChange={(next) => { if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next !== value) onCommit(next); }} />;
}

export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; direction: SortDirection } | null;

/** A header that sorts its column: first click in the column's natural order, second reverses, third goes back to the default. */
export function SortableHead<K extends string>({ column, label, sort, onSort, className, defaultDirection = "desc" }: { column: K; label: React.ReactNode; sort: SortState<K>; onSort: (next: SortState<K>) => void; className?: string; defaultDirection?: SortDirection }) {
  const active = sort?.key === column;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  const next = (): SortState<K> => !active ? { key: column, direction: defaultDirection } : sort.direction === defaultDirection ? { key: column, direction: defaultDirection === "asc" ? "desc" : "asc" } : null;
  return <TableHead className={cn(sheetHead, className)} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
    <button type="button" onClick={() => onSort(next())} className={cn("inline-flex items-center gap-1 rounded hover:text-foreground", active && "text-foreground")}>
      {label}<Icon className={cn("size-3.5", !active && "opacity-40")} aria-hidden="true" />
    </button>
  </TableHead>;
}

export type FilterDef = { id: string; label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string; hint?: string }[] };

/** Search box, filters and how many rows match, above a table. */
export function TableToolbar({ search, onSearch, placeholder, filters = [], shown, total, children }: { search: string; onSearch: (value: string) => void; placeholder: string; filters?: FilterDef[]; shown: number; total: number; children?: React.ReactNode }) {
  const filtered = Boolean(search) || filters.some((filter) => filter.value !== filter.options[0]?.value);
  return <div className="flex flex-wrap items-center gap-2">
    <div className="relative min-w-52 flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-8 pr-8 pl-8" />
      {search ? <button type="button" aria-label="Borrar búsqueda" onClick={() => onSearch("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button> : null}
    </div>
    {filters.map((filter) => <Dropdown key={filter.id} aria-label={filter.label} value={filter.value} onChange={(event) => filter.onChange(event.target.value)} className={cn(filter.value !== filter.options[0]?.value && "border-foreground/30 bg-accent/40")}>
      {filter.options.map((option) => <DropdownOption key={option.value} value={option.value} hint={option.hint}>{option.label}</DropdownOption>)}
    </Dropdown>)}
    {children}
    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{filtered ? `${shown} de ${total}` : `${total}`} {total === 1 ? "registro" : "registros"}</span>
  </div>;
}

/** Accent- and case-insensitive text match over several fields. */
export function matches(query: string, fields: (string | null | undefined)[]): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize(fields.filter(Boolean).join(" "));
  return terms.every((term) => haystack.includes(term));
}

/** A text cell that suggests values used before; picking one saves it right away. */
export function EditableSuggest(props: CommitProps<string> & { suggestions: Suggestion[]; onPick?: (suggestion: Suggestion) => void }) {
  return <EditableSuggestCell key={props.value} {...props} />;
}

function EditableSuggestCell({ value, label, onCommit, disabled, className, placeholder, suggestions, onPick }: CommitProps<string> & { suggestions: Suggestion[]; onPick?: (suggestion: Suggestion) => void }) {
  const [text, setText] = React.useState(value);
  const latest = React.useRef(value);
  const committed = React.useRef(value);
  const commit = (next: string) => {
    const clean = next.trim();
    if (clean === committed.current) return;
    committed.current = clean;
    onCommit(clean);
  };
  return <SuggestInput variant="cell" value={text} suggestions={suggestions} aria-label={label} title={value || undefined} placeholder={placeholder} disabled={disabled} className={className}
    onPick={onPick}
    onValueChange={(next, picked) => { setText(next); latest.current = next; if (picked) commit(next); }}
    onBlur={() => commit(latest.current)}
    onKeyDown={(event) => {
      if (event.key === "Escape") { setText(committed.current); latest.current = committed.current; }
      if (event.key === "Enter") { const target = event.currentTarget; window.setTimeout(() => target.blur(), 0); }
    }} />;
}

/**
 * State remembered per section in this browser (filters, chosen tab), so coming back finds it as it was.
 * Storage can be unavailable (private windows, blocked site data): then it simply is not remembered.
 */
export function usePersistentState<T extends string>(key: string, initial: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = React.useState<T>(initial);
  const [loaded, setLoaded] = React.useState(false);
  if (!loaded && typeof window !== "undefined") {
    setLoaded(true);
    try { const stored = window.localStorage.getItem(`cozte:${key}`) as T | null; if (stored !== null && (!allowed || allowed.includes(stored))) setValue(stored); } catch { /* Not remembered. */ }
  }
  const update = React.useCallback((next: T) => {
    setValue(next);
    try { window.localStorage.setItem(`cozte:${key}`, next); } catch { /* Not remembered. */ }
  }, [key]);
  return [value, update];
}

/** The month's name for totals: "septiembre". */
export const monthName = (month: string) => new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));

/**
 * Downloads rows as a CSV that Excel in Spanish opens directly: semicolon separator, decimal comma, UTF-8 with BOM
 * so accents survive. Dates stay as AAAA-MM-DD, which Excel reads as dates.
 */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "number" ? String(Math.round(value * 100) / 100).replace(".", ",") : value;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const content = "﻿" + [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Descargar Excel" with a choice of what to download, for sections with more than one table. */
export function ExportMenu({ options, className }: { options: { label: string; hint?: string; onSelect: () => void }[]; className?: string }) {
  return <MenuPrimitive.Root>
    <MenuPrimitive.Trigger className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-sm font-medium whitespace-nowrap shadow-xs outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:bg-accent", className)}>
      <Download className="size-4" aria-hidden="true" />Descargar Excel<ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
    </MenuPrimitive.Trigger>
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="isolate z-50 outline-none">
        <MenuPrimitive.Popup className="w-64 max-w-[calc(100vw-2rem)] origin-(--transform-origin) rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0">
          {options.map((option) => <MenuPrimitive.Item key={option.label} onClick={option.onSelect} className="flex cursor-default flex-col gap-0.5 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
            <span className="font-medium">{option.label}</span>
            {option.hint ? <span className="text-xs text-muted-foreground">{option.hint}</span> : null}
          </MenuPrimitive.Item>)}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  </MenuPrimitive.Root>;
}
