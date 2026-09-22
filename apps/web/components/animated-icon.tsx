"use client";

import type { ComponentProps } from "react";
import {
  ArrowLeftIcon,
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  AttachFileIcon,
  BadgeAlertIcon,
  BotMessageSquareIcon,
  BoxesIcon,
  ChartLineIcon,
  CheckIcon,
  ClipboardCheckIcon,
  CloudUploadIcon,
  DeleteIcon,
  HistoryIcon,
  LayoutGridIcon,
  LayersIcon,
  ListIcon,
  MessageCircleMoreIcon,
  MicIcon,
  PauseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquarePenIcon,
  UploadIcon,
  XIcon,
} from "lucide-animated";

const icons = {
  arrowLeft: ArrowLeftIcon,
  arrowDownRight: ArrowDownRightIcon,
  arrowRight: ArrowRightIcon,
  arrowUpRight: ArrowUpRightIcon,
  attach: AttachFileIcon,
  alert: BadgeAlertIcon,
  assistant: BotMessageSquareIcon,
  boxes: BoxesIcon,
  chart: ChartLineIcon,
  check: CheckIcon,
  review: ClipboardCheckIcon,
  cloud: CloudUploadIcon,
  delete: DeleteIcon,
  history: HistoryIcon,
  dashboard: LayoutGridIcon,
  layers: LayersIcon,
  costs: ListIcon,
  message: MessageCircleMoreIcon,
  mic: MicIcon,
  pause: PauseIcon,
  panel: PanelLeftOpenIcon,
  plus: PlusIcon,
  receipt: ReceiptTextIcon,
  refresh: RefreshCwIcon,
  search: SearchIcon,
  send: SendIcon,
  sparkles: SparklesIcon,
  edit: SquarePenIcon,
  upload: UploadIcon,
  close: XIcon,
} as const;

export type AnimatedIconName = keyof typeof icons;

type Props = Omit<ComponentProps<"span">, "children"> & {
  name: AnimatedIconName;
  size?: number;
};

export function AnimatedIcon({ name, size = 18, className, ...props }: Props) {
  const Icon = icons[name];
  return (
    <span className={["cozte-animated-icon", className].filter(Boolean).join(" ")} aria-hidden="true" {...props}>
      <Icon size={size} />
    </span>
  );
}
