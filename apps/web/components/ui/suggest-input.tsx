"use client"

import * as React from "react"
import { Autocomplete } from "@base-ui/react/autocomplete"
import { cn } from "@/lib/utils"

/**
 * A text field that suggests what was already typed before (customers, addresses, who delivers), without forcing
 * a choice: whatever the person writes is valid. Picking a suggestion can fill related fields through `onPick`.
 */

export type Suggestion = { value: string; hint?: string }

type Props = Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange"> & {
  value: string
  onValueChange: (value: string, picked: boolean) => void
  suggestions: Suggestion[]
  onPick?: (suggestion: Suggestion) => void
  /** A borderless field that fills a table cell. */
  variant?: "default" | "cell"
}

const MAX_SHOWN = 8

export function SuggestInput({ value, onValueChange, suggestions, onPick, variant = "default", className, ...input }: Props) {
  const items = React.useMemo(() => {
    const seen = new Set<string>()
    return suggestions.filter((item) => { const key = item.value.trim().toLowerCase(); if (!key || seen.has(key)) return false; seen.add(key); return true })
  }, [suggestions])
  const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  const query = normalize(value.trim())
  // Only what matches and is not already exactly what is written.
  const shown = React.useMemo(() => items.filter((item) => { const text = normalize(item.value); return text !== query && (!query || text.includes(query)) }).slice(0, MAX_SHOWN), [items, query])
  // Open only while the person is in the field: a pick, or the form clearing it after saving, never leaves it open.
  const [open, setOpen] = React.useState(false)
  return <Autocomplete.Root items={shown} filteredItems={shown} value={value} itemToStringValue={(item: Suggestion) => item.value}
    open={open && shown.length > 0} onOpenChange={(next) => setOpen(next)}
    onValueChange={(next, details) => {
      // Escape closes the list or reverts (handled by the field); it never wipes what was written.
      if (details.reason === "escape-key") return
      const picked = details.reason === "item-press"
      if (picked) setOpen(false)
      onValueChange(next, picked)
      if (picked) { const match = items.find((item) => item.value === next); if (match) onPick?.(match) }
    }}>
    <Autocomplete.Input {...input} autoComplete="off" onBlur={(event) => { setOpen(false); input.onBlur?.(event) }}
      className={cn(
        variant === "default" && "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        variant === "cell" && "h-11 w-full min-w-0 rounded-none border-0 bg-transparent px-3 text-sm shadow-none outline-none transition-colors placeholder:text-muted-foreground hover:bg-accent/30 focus-visible:relative focus-visible:z-10 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )} />
    {shown.length ? <Autocomplete.Portal>
      <Autocomplete.Positioner sideOffset={4} align="start" className="isolate z-50 outline-none">
        <Autocomplete.Popup className="max-h-[min(18rem,var(--available-height))] min-w-(--anchor-width) max-w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none">
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">Usados antes</div>
          <Autocomplete.List>
            {(item: Suggestion) => <Autocomplete.Item key={item.value} value={item} className="flex cursor-default flex-col rounded-lg px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground">
              <span className="truncate">{item.value}</span>
              {item.hint ? <span className="truncate text-xs text-muted-foreground">{item.hint}</span> : null}
            </Autocomplete.Item>}
          </Autocomplete.List>
        </Autocomplete.Popup>
      </Autocomplete.Positioner>
    </Autocomplete.Portal> : null}
  </Autocomplete.Root>
}
