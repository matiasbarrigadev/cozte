"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The app's date and month fields: a calendar in a popover that replaces the browser's native pickers, with the
 * same shape everywhere (forms, filters and table cells). Values stay as the native ones, AAAA-MM-DD and AAAA-MM,
 * and a `name` sends them with the form, so a native date input can switch without changing its logic.
 */

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/
const pad = (value: number) => String(value).padStart(2, "0")
const dayIso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
const partsOf = (value: string) => { const [year, month, day = 1] = value.split("-").map(Number); return { year, month: month - 1, day } }
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
/** Monday is the first day of the week. */
const weekdayOf = (value: string) => (new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7
const addDays = (value: string, days: number) => { const { year, month, day } = partsOf(value); return dayIso(year, month, day + days) }
const addMonths = (value: string, months: number) => { const { year, month, day } = partsOf(value); const target = new Date(Date.UTC(year, month + months, 1)); return dayIso(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, daysIn(target.getUTCFullYear(), target.getUTCMonth()))) }
const clampDay = (value: string, min?: string, max?: string) => min && value < min ? min : max && value > max ? max : value
const localToday = () => new Date().toLocaleDateString("en-CA")

/** "27 sep 2026". */
export const formatDay = (value: string) => { if (!ISO_DAY.test(value)) return value; const { year, month, day } = partsOf(value); return `${day} ${SHORT_MONTHS[month]} ${year}` }
/** "Septiembre 2026". */
export const formatMonth = (value: string) => { if (!ISO_MONTH.test(value)) return value; const { year, month } = partsOf(value); return `${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}` }
const longDay = (value: string) => { const { year, month, day } = partsOf(value); return `${WEEKDAYS[weekdayOf(value)]} ${day} de ${MONTHS[month]} de ${year}` }

type FieldProps = {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  name?: string
  id?: string
  required?: boolean
  disabled?: boolean
  min?: string
  max?: string
  /** Shows "Borrar" so the field can be left empty. */
  clearable?: boolean
  placeholder?: string
  /** A borderless trigger that fills a table cell. */
  variant?: "default" | "cell"
  size?: "sm" | "default"
  className?: string
  /** The business's "today" (the demo has its own clock); by default, the browser's. */
  today?: string
  title?: string
  "aria-label"?: string
  "aria-describedby"?: string
}

function useFieldValue(value: string | undefined, defaultValue: string | undefined, onChange?: (value: string) => void) {
  const [inner, setInner] = React.useState(defaultValue ?? "")
  const current = value ?? inner
  const set = (next: string) => { if (value === undefined) setInner(next); if (next !== current) onChange?.(next) }
  return [current, set] as const
}

const triggerClass = (variant: "default" | "cell") => cn(
  "group/date inline-flex min-w-0 items-center gap-2 text-left text-sm whitespace-nowrap tabular-nums outline-none select-none transition-[color,background-color,border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground",
  variant === "default" && "h-8 w-full rounded-lg border border-input bg-background/60 px-2.5 shadow-xs hover:border-foreground/25 hover:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/25 data-[size=sm]:h-7 data-[size=sm]:rounded-md data-[size=sm]:px-2 data-[size=sm]:text-xs dark:bg-input/30",
  variant === "cell" && "h-11 w-full rounded-none border-0 bg-transparent px-3 hover:bg-accent/30 focus-visible:relative focus-visible:z-10 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-100 data-popup-open:bg-background",
)

/** The trigger, the value sent with the form (validated like a native field) and the popover around a calendar. */
function PickerShell({ open, onOpenChange, current, display, props, initialFocus, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; current: string; display: string; props: FieldProps
  initialFocus: React.RefObject<HTMLElement | null>; children: React.ReactNode
}) {
  const { name, id, required, disabled, placeholder = "Elegir", variant = "default", size = "default", className, title } = props
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  return <PopoverPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <PopoverPrimitive.Trigger ref={triggerRef} id={id} disabled={disabled} title={title} data-size={size} data-placeholder={current ? undefined : ""}
        aria-label={props["aria-label"] ? `${props["aria-label"]}${current ? `: ${display}` : ""}` : undefined} aria-describedby={props["aria-describedby"]}
        className={triggerClass(variant)}>
        <CalendarDays className={cn("size-4 shrink-0 text-muted-foreground", variant === "cell" && "size-3.5 opacity-50 group-hover/date:opacity-100")} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{current ? display : placeholder}</span>
      </PopoverPrimitive.Trigger>
      {name || required ? <input tabIndex={-1} aria-hidden="true" name={name} value={current} required={required} disabled={disabled} onChange={() => {}}
        onFocus={() => triggerRef.current?.focus()} className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" /> : null}
    </span>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="isolate z-50 outline-none">
        <PopoverPrimitive.Popup initialFocus={initialFocus}
          className="w-[17.5rem] origin-(--transform-origin) rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}

const navButton = "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
const footerButton = "rounded-md px-2 py-1 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
const cellButton = "relative flex items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-30 aria-selected:bg-primary aria-selected:font-semibold aria-selected:text-primary-foreground aria-selected:hover:bg-primary"

/** Year and month, to jump far without clicking month by month. */
function MonthGrid({ year, setYear, selected, current, min, max, onPick, focusRef, autoFocus }: {
  year: number; setYear: (year: number) => void; selected?: string; current: string; min?: string; max?: string
  onPick: (month: string) => void; focusRef?: React.RefObject<HTMLButtonElement | null>; autoFocus?: boolean
}) {
  const initial = selected && partsOf(selected).year === year ? selected : `${year}-${current.slice(5, 7)}`
  const [picked, setFocused] = React.useState(initial)
  // The focused month follows the year on screen when the arrows change it.
  const focused = partsOf(picked).year === year ? picked : `${year}-${picked.slice(5, 7)}`
  const gridRef = React.useRef<HTMLDivElement>(null)
  const move = React.useRef(autoFocus ?? false)
  React.useEffect(() => {
    if (!move.current) return
    move.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-month="${focused}"]`)?.focus()
  }, [focused])
  const outOfRange = (month: string) => Boolean(min && month < min.slice(0, 7) || max && month > max.slice(0, 7))
  const shift = (months: number) => {
    const { year: y, month } = partsOf(focused)
    const target = new Date(Date.UTC(y, month + months, 1))
    const next = `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}`
    move.current = true
    setFocused(next)
    if (target.getUTCFullYear() !== year) setYear(target.getUTCFullYear())
  }
  return <div className="flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <button type="button" className={navButton} aria-label="Año anterior" disabled={Boolean(min && `${year - 1}-12` < min.slice(0, 7))} onClick={() => setYear(year - 1)}><ChevronLeft className="size-4" /></button>
      <span className="text-sm font-semibold tabular-nums" aria-live="polite">{year}</span>
      <button type="button" className={navButton} aria-label="Año siguiente" disabled={Boolean(max && `${year + 1}-01` > max.slice(0, 7))} onClick={() => setYear(year + 1)}><ChevronRight className="size-4" /></button>
    </div>
    <div ref={gridRef} role="grid" aria-label={`Meses de ${year}`} className="grid grid-cols-3 gap-1"
      onKeyDown={(event) => {
        const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }
        if (event.key in steps) { event.preventDefault(); shift(steps[event.key]) }
      }}>
      {MONTHS.map((name, index) => {
        const month = `${year}-${pad(index + 1)}`
        return <button key={month} type="button" role="gridcell" data-month={month} aria-selected={month === selected} aria-label={`${name} de ${year}`}
          ref={month === focused ? focusRef : undefined} tabIndex={month === focused ? 0 : -1} disabled={outOfRange(month)} onClick={() => onPick(month)}
          className={cn(cellButton, "h-10 capitalize", month === current && month !== selected && "font-semibold text-primary")}>
          {SHORT_MONTHS[index]}
          {month === current ? <span className="absolute bottom-1 size-1 rounded-full bg-current" aria-hidden="true" /> : null}
        </button>
      })}
    </div>
  </div>
}

export function DatePicker(props: FieldProps) {
  const { value, defaultValue, onChange, min, max, clearable } = props
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange)
  const today = props.today && ISO_DAY.test(props.today) ? props.today : localToday()
  const selected = ISO_DAY.test(current) ? current : undefined
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"days" | "months">("days")
  const [focused, setFocused] = React.useState(() => clampDay(selected ?? today, min, max))
  const [yearView, setYearView] = React.useState(() => partsOf(focused).year)
  const focusRef = React.useRef<HTMLButtonElement>(null)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const moveFocus = React.useRef(false)
  const { year, month } = partsOf(focused)

  React.useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus()
  }, [focused])

  const openChange = (next: boolean) => {
    if (next) { const start = clampDay(selected ?? today, min, max); setFocused(start); setYearView(partsOf(start).year); setMode("days") }
    setOpen(next)
  }
  const pick = (day: string) => { setCurrent(day); setOpen(false) }
  const go = (day: string) => { moveFocus.current = true; setFocused(clampDay(day, min, max)) }
  const outOfRange = (day: string) => Boolean(min && day < min || max && day > max)

  const first = dayIso(year, month, 1)
  const start = addDays(first, -weekdayOf(first))
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index))
  const weeks = Array.from({ length: days[35].slice(0, 7) === `${year}-${pad(month + 1)}` ? 6 : 5 }, (_, index) => days.slice(index * 7, index * 7 + 7))

  return <PickerShell open={open} onOpenChange={openChange} current={current} display={selected ? formatDay(selected) : current} props={props} initialFocus={focusRef}>
    {mode === "months" ? <MonthGrid year={yearView} setYear={setYearView} selected={`${year}-${pad(month + 1)}`} current={today.slice(0, 7)} min={min} max={max} focusRef={focusRef} autoFocus
      onPick={(picked) => { const { year: y, month: m } = partsOf(picked); go(dayIso(y, m, Math.min(partsOf(focused).day, daysIn(y, m)))); setMode("days") }} /> : <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        <button type="button" className={navButton} aria-label="Mes anterior" disabled={Boolean(min && first <= min)} onClick={() => setFocused(clampDay(addMonths(focused, -1), min, max))}><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => { setYearView(year); setMode("months") }} aria-label={`${MONTHS[month]} de ${year}. Elegir otro mes`}
          className="rounded-lg px-2 py-1 text-sm font-semibold capitalize outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50" aria-live="polite">
          {MONTHS[month]} {year}
        </button>
        <button type="button" className={navButton} aria-label="Mes siguiente" disabled={Boolean(max && dayIso(year, month, daysIn(year, month)) >= max)} onClick={() => setFocused(clampDay(addMonths(focused, 1), min, max))}><ChevronRight className="size-4" /></button>
      </div>
      <div ref={gridRef} role="grid" aria-label={`${MONTHS[month]} de ${year}`} className="flex flex-col gap-0.5"
        onKeyDown={(event) => {
          const steps: Record<string, () => string> = {
            ArrowLeft: () => addDays(focused, -1), ArrowRight: () => addDays(focused, 1), ArrowUp: () => addDays(focused, -7), ArrowDown: () => addDays(focused, 7),
            PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1), PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
            Home: () => addDays(focused, -weekdayOf(focused)), End: () => addDays(focused, 6 - weekdayOf(focused)),
          }
          if (event.key in steps) { event.preventDefault(); go(steps[event.key]()) }
        }}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((name) => <span key={name} role="columnheader" aria-label={name} className="py-1 text-center text-[11px] font-medium text-muted-foreground uppercase">{name.slice(0, 2)}</span>)}
        </div>
        {weeks.map((week) => <div key={week[0]} role="row" className="grid grid-cols-7 gap-0.5">
          {week.map((day) => {
            const inMonth = partsOf(day).month === month
            return <button key={day} type="button" role="gridcell" data-day={day} aria-selected={day === selected} aria-current={day === today ? "date" : undefined} aria-label={longDay(day)}
              ref={day === focused ? focusRef : undefined} tabIndex={day === focused ? 0 : -1} disabled={outOfRange(day)} onClick={() => pick(day)}
              className={cn(cellButton, "h-9", !inMonth && "text-muted-foreground/60", day === today && day !== selected && "font-semibold text-primary")}>
              {partsOf(day).day}
              {day === today ? <span className="absolute bottom-1 size-1 rounded-full bg-current" aria-hidden="true" /> : null}
            </button>
          })}
        </div>)}
      </div>
    </div>}
    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
      {clearable ? <button type="button" className={cn(footerButton, "text-muted-foreground")} disabled={!current} onClick={() => pick("")}>Borrar</button> : <span />}
      <div className="flex gap-1">
        {!outOfRange(addDays(today, -1)) ? <button type="button" className={footerButton} onClick={() => pick(addDays(today, -1))}>Ayer</button> : null}
        <button type="button" className={cn(footerButton, "text-primary")} disabled={outOfRange(today)} onClick={() => pick(today)}>Hoy</button>
        {!outOfRange(addDays(today, 1)) ? <button type="button" className={footerButton} onClick={() => pick(addDays(today, 1))}>Mañana</button> : null}
      </div>
    </div>
  </PickerShell>
}

export function MonthSelect(props: FieldProps) {
  const { value, defaultValue, onChange, min, max, clearable } = props
  const [current, setCurrent] = useFieldValue(value, defaultValue, onChange)
  const thisMonth = (props.today && ISO_DAY.test(props.today) ? props.today : localToday()).slice(0, 7)
  const selected = ISO_MONTH.test(current) ? current : undefined
  const [open, setOpen] = React.useState(false)
  const [year, setYear] = React.useState(() => partsOf(selected ?? thisMonth).year)
  const focusRef = React.useRef<HTMLButtonElement>(null)
  const outOfRange = (month: string) => Boolean(min && month < min.slice(0, 7) || max && month > max.slice(0, 7))
  const pick = (month: string) => { setCurrent(month); setOpen(false) }
  return <PickerShell open={open} onOpenChange={(next) => { if (next) setYear(partsOf(selected ?? thisMonth).year); setOpen(next) }} current={current}
    display={selected ? formatMonth(selected) : current} props={{ placeholder: "Elegir mes", ...props }} initialFocus={focusRef}>
    <MonthGrid year={year} setYear={setYear} selected={selected} current={thisMonth} min={min} max={max} onPick={pick} focusRef={focusRef} />
    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
      {clearable ? <button type="button" className={cn(footerButton, "text-muted-foreground")} disabled={!current} onClick={() => pick("")}>Borrar</button> : <span />}
      <button type="button" className={cn(footerButton, "text-primary")} disabled={outOfRange(thisMonth)} onClick={() => pick(thisMonth)}>Este mes</button>
    </div>
  </PickerShell>
}
