"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The app's dropdown: a styled, keyboard-friendly list that replaces the browser's native select. It keeps the
 * native API the app already uses (options as children, `onChange` with `event.target.value`, `name` and
 * `defaultValue` inside forms), so any select can switch to it without changing its logic.
 */

export type DropdownChangeEvent = { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }

type OptionProps = { value: string; disabled?: boolean; hint?: React.ReactNode; children?: React.ReactNode }
type GroupProps = { label: string; children?: React.ReactNode }

/** One choice. `hint` adds a short line under it in the list (not in the closed dropdown). */
export function DropdownOption(props: OptionProps): React.ReactNode { void props; return null }
DropdownOption.dropdownRole = "option" as const
/** A labeled section of choices. */
export function DropdownGroup(props: GroupProps): React.ReactNode { void props; return null }
DropdownGroup.dropdownRole = "group" as const

/** Options are recognized by a role mark, not by function identity, so they keep working across module reloads. */
const roleOf = (type: unknown) => type === "option" ? "option" : type === "optgroup" ? "group" : (type as { dropdownRole?: string } | null)?.dropdownRole

type Item = { value: string; label: React.ReactNode; text: string; disabled?: boolean; hint?: React.ReactNode }
type Section = { label?: string; items: Item[] }

const textOf = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

/** Reads options and groups from the children, flattening fragments, arrays and conditionals. */
function collect(children: React.ReactNode, sections: Section[], current: Section): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === React.Fragment) { collect((child.props as { children?: React.ReactNode }).children, sections, current); return }
    const role = roleOf(child.type)
    if (role === "option") {
      const props = child.props as OptionProps
      current.items.push({ value: String(props.value ?? ""), label: props.children, text: textOf(props.children), disabled: props.disabled, hint: props.hint })
      return
    }
    if (role === "group") {
      const props = child.props as GroupProps
      const section: Section = { label: props.label, items: [] }
      sections.push(section)
      collect(props.children, sections, section)
      const rest: Section = { items: [] }
      sections.push(rest)
      current = rest
    }
  })
}

type DropdownProps = {
  value?: string
  defaultValue?: string
  onChange?: (event: DropdownChangeEvent) => void
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  size?: "sm" | "default"
  className?: string
  placeholder?: string
  title?: string
  "aria-label"?: string
  "aria-describedby"?: string
  /** A borderless trigger that fills a table cell. */
  variant?: "default" | "cell"
  children?: React.ReactNode
}

export function Dropdown({ value, defaultValue, onChange, name, id, disabled, required, size = "default", className, placeholder, title, variant = "default", children, ...aria }: DropdownProps) {
  const sections = React.useMemo(() => {
    const root: Section = { items: [] }
    const list: Section[] = [root]
    collect(children, list, root)
    return list.filter((section) => section.items.length)
  }, [children])
  const items = React.useMemo(() => sections.flatMap((section) => section.items.map((item) => ({ value: item.value, label: item.label }))), [sections])
  // Like a native select, an uncontrolled dropdown starts on its first available option.
  const initial = value === undefined && defaultValue === undefined ? sections.flatMap((section) => section.items).find((item) => !item.disabled)?.value : defaultValue
  const emit = (next: unknown) => {
    const text = next === null || next === undefined ? "" : String(next)
    onChange?.({ target: { value: text, name }, currentTarget: { value: text, name } })
  }
  return <SelectPrimitive.Root items={items} value={value} defaultValue={initial} onValueChange={emit} name={name} disabled={disabled} required={required}>
    <SelectPrimitive.Trigger id={id} title={title} aria-label={aria["aria-label"]} aria-describedby={aria["aria-describedby"]} data-size={size}
      className={cn(
        "group/dropdown inline-flex min-w-0 items-center justify-between gap-2 text-left text-sm whitespace-nowrap outline-none select-none transition-[color,background-color,border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground",
        variant === "default" && "h-8 w-fit rounded-lg border border-input bg-background/60 px-2.5 shadow-xs hover:border-foreground/25 hover:bg-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 data-popup-open:border-ring data-popup-open:ring-3 data-popup-open:ring-ring/25 data-[size=sm]:h-7 data-[size=sm]:rounded-md data-[size=sm]:px-2 data-[size=sm]:text-xs dark:bg-input/30",
        variant === "cell" && "h-11 w-full rounded-none border-0 bg-transparent px-3 hover:bg-accent/30 focus-visible:relative focus-visible:z-10 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-100",
        className
      )}>
      <SelectPrimitive.Value className="min-w-0 flex-1 truncate" placeholder={placeholder} />
      <SelectPrimitive.Icon className="flex shrink-0 text-muted-foreground transition-transform duration-150 group-data-popup-open/dropdown:rotate-180">
        <ChevronDownIcon className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner side="bottom" align="start" sideOffset={6} alignItemWithTrigger={false} className="isolate z-50 outline-none">
        <SelectPrimitive.Popup className="max-h-[min(22rem,var(--available-height))] min-w-(--anchor-width) max-w-[min(28rem,calc(100vw-2rem))] origin-(--transform-origin) overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <SelectPrimitive.List>
            {sections.map((section, index) => <SelectPrimitive.Group key={`${section.label ?? "items"}-${index}`} className={cn(index > 0 && "mt-1 border-t pt-1")}>
              {section.label ? <SelectPrimitive.GroupLabel className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{section.label}</SelectPrimitive.GroupLabel> : null}
              {section.items.map((item) => <SelectPrimitive.Item key={item.value} value={item.value} disabled={item.disabled} label={item.text}
                className="relative flex cursor-default items-start gap-2 rounded-lg py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:font-medium">
                <span className="flex min-w-0 flex-col">
                  <SelectPrimitive.ItemText className="truncate">{item.label}</SelectPrimitive.ItemText>
                  {item.hint ? <span className="text-xs font-normal text-muted-foreground">{item.hint}</span> : null}
                </span>
                <SelectPrimitive.ItemIndicator className="absolute top-2 right-2 flex size-4 items-center justify-center text-foreground">
                  <CheckIcon className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>)}
            </SelectPrimitive.Group>)}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
