"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { Dropdown, DropdownOption } from "@/components/ui/dropdown";
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

export function EditableDate({ value, label, onCommit, disabled, className }: CommitProps<string>) {
  return <Input key={value} type="date" defaultValue={value} aria-label={label} disabled={disabled} className={cn(cellInput, "tabular-nums", className)}
    onBlur={(event) => { const next = event.currentTarget.value; if (/^\d{4}-\d{2}-\d{2}$/.test(next) && next !== value) onCommit(next); else if (!next) event.currentTarget.value = value; }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.currentTarget.value = value; event.currentTarget.blur(); } }} />;
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
