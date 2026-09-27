"use client";

import { useEffect, useRef, type ComponentProps, type ForwardRefExoticComponent, type RefAttributes } from "react";
import {
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
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
  MaximizeIcon,
  ListIcon,
  MessageCircleMoreIcon,
  MicIcon,
  PauseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  ProjectorIcon,
  ReceiptTextIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquarePenIcon,
  TruckIcon,
  UsersIcon,
  HandCoinsIcon,
  UploadIcon,
  XIcon,
} from "lucide-animated";

const icons = {
  arrowLeft: ArrowLeftIcon,
  arrowUp: ArrowUpIcon,
  arrowDown: ArrowDownIcon,
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
  expand: MaximizeIcon,
  costs: ListIcon,
  message: MessageCircleMoreIcon,
  mic: MicIcon,
  pause: PauseIcon,
  panel: PanelLeftOpenIcon,
  plus: PlusIcon,
  presentation: ProjectorIcon,
  receipt: ReceiptTextIcon,
  refresh: RefreshCwIcon,
  search: SearchIcon,
  send: SendIcon,
  sparkles: SparklesIcon,
  edit: SquarePenIcon,
  truck: TruckIcon,
  users: UsersIcon,
  sales: HandCoinsIcon,
  upload: UploadIcon,
  close: XIcon,
} as const;

export type AnimatedIconName = keyof typeof icons;

type Props = Omit<ComponentProps<"span">, "children"> & {
  name: AnimatedIconName;
  size?: number;
};

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

type IconComponent = ForwardRefExoticComponent<
  Omit<ComponentProps<"div">, "ref"> & { size?: number; animateOnHover?: boolean } & RefAttributes<AnimatedIconHandle>
>;

export function AnimatedIcon({ name, size = 18, className, ...props }: Props) {
  const Icon = icons[name] as IconComponent;
  const iconRef = useRef<AnimatedIconHandle>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const target = wrapper.closest<HTMLElement>('button, a, [role="button"], [data-animated-icon-container], article') ?? wrapper;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = () => { if (!reducedMotion.matches) iconRef.current?.startAnimation(); };
    const stop = () => iconRef.current?.stopAnimation();

    target.addEventListener("mouseenter", start);
    target.addEventListener("mouseleave", stop);
    target.addEventListener("focusin", start);
    target.addEventListener("focusout", stop);
    return () => {
      target.removeEventListener("mouseenter", start);
      target.removeEventListener("mouseleave", stop);
      target.removeEventListener("focusin", start);
      target.removeEventListener("focusout", stop);
    };
  }, []);

  return (
    <span ref={wrapperRef} className={["cozte-animated-icon", className].filter(Boolean).join(" ")} aria-hidden="true" {...props}>
      <Icon ref={iconRef} size={size} animateOnHover={false} />
    </span>
  );
}
