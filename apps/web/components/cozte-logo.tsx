import Link from "next/link";

export function CozteLogo({ href, className = "", markClassName = "" }: { href?: string; className?: string; markClassName?: string }) {
  const content = <><span className={["cozte-logo-mark", markClassName].filter(Boolean).join(" ")} aria-hidden="true" /><span className="cozte-logo-word">cozte</span></>;
  const classes = ["cozte-logo", className].filter(Boolean).join(" ");
  return href ? <Link href={href} className={classes} aria-label="Cozte, inicio">{content}</Link> : <span className={classes}>{content}</span>;
}
