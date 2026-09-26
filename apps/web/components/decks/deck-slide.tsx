"use client";

import * as React from "react";
import { formatValue, monthLabel, type Deck, type DeckTheme, type Slide } from "@/lib/decks";
import { DeckChart } from "./deck-charts";

export const SLIDE_WIDTH = 1280;
export const SLIDE_HEIGHT = 720;

type SlideProps = { slide: Slide; index: number; total: number; deck: Deck; title: string; theme: DeckTheme };

/** Picks a font size from the amount of text, so long titles shrink instead of overflowing the canvas. */
const fit = (text: string, sizes: [number, number][]) => sizes.find(([max]) => text.length <= max)?.[1] ?? sizes.at(-1)![1];

/** Largest size at which a figure fits its card: cards narrow as more of them share the row. */
const KPI_WIDTH: Record<number, number> = { 1: 560, 2: 480, 3: 290, 4: 196 };
const kpiSize = (value: string, count: number) => Math.round(Math.max(26, Math.min(count > 2 ? 64 : 88, (KPI_WIDTH[count] ?? 196) / (value.length * 0.64))));

const dataDate = (value: string) => value ? new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "";

/** One slide at its native 1280×720 size; ScaledSlide fits it to any container. */
export function SlideView({ slide, index, total, deck, title, theme }: SlideProps) {
  return <div className={`deck-slide deck-theme-${theme}`} data-layout={slide.layout}>
    <SlideBody slide={slide} deck={deck} title={title} />
    {slide.layout !== "cover" ? <footer className="deck-footer">
      <span className="deck-footer-brand"><span className="cozte-logo-mark" aria-hidden="true" />{title}</span>
      <span>{index + 1} / {total}</span>
    </footer> : null}
  </div>;
}

function SlideBody({ slide, deck, title }: { slide: Slide; deck: Deck; title: string }) {
  switch (slide.layout) {
    case "cover": return <Cover slide={slide} deck={deck} />;
    case "section": return <div className="deck-pad deck-section">
      <span className="deck-kicker">{slide.subtitle ?? title}</span>
      <h2 className="deck-heading" style={{ fontSize: fit(slide.title, [[40, 92], [80, 72], [999, 56]]) }}>{slide.title}</h2>
      {slide.text ? <p className="deck-lead" style={{ fontSize: fit(slide.text, [[160, 30], [999, 24]]) }}>{slide.text}</p> : null}
    </div>;
    case "bullets": return <div className="deck-pad">
      <Header slide={slide} />
      {slide.text ? <p className="deck-intro">{slide.text}</p> : null}
      <Bullets items={slide.bullets ?? []} />
    </div>;
    case "chart": return <ChartSlide slide={slide} deck={deck} />;
    case "kpis": return <div className="deck-pad">
      <Header slide={slide} />
      <div className="deck-kpis" data-count={slide.kpis?.length ?? 0}>
        {(slide.kpis ?? []).map((kpi, index) => {
          // A loss is already named in the label ("Pérdida del mes"): the figure shows its size, in red.
          const value = formatValue(kpi.metric === "result" && kpi.value !== null ? Math.abs(kpi.value) : kpi.value, kpi.format, deck.currency);
          const negative = kpi.value !== null && kpi.value < 0;
          return <div key={`${kpi.metric}-${index}`} className="deck-kpi">
            <span className="deck-kpi-label">{kpi.label}</span>
            <span className="deck-heading deck-kpi-value" style={{ fontSize: kpiSize(value, slide.kpis?.length ?? 1), color: negative ? "var(--deck-negative)" : undefined }}>{value}</span>
            {kpi.note ? <span className="deck-kpi-note">{kpi.note}</span> : null}
          </div>;
        })}
      </div>
      {slide.text ? <p className="deck-takeaway">{slide.text}</p> : null}
    </div>;
    case "comparison": return <div className="deck-pad">
      <Header slide={slide} />
      <div className="deck-columns">
        {[slide.left, slide.right].map((column, index) => column ? <div key={index} className="deck-column" data-side={index ? "right" : "left"}>
          <span className="deck-column-title">{column.title}</span>
          <Bullets items={column.bullets} compact />
        </div> : <div key={index} />)}
      </div>
      {slide.text ? <p className="deck-takeaway">{slide.text}</p> : null}
    </div>;
    case "closing": return <div className="deck-pad deck-closing">
      <div className="deck-closing-head">
        <h2 className="deck-heading" style={{ fontSize: fit(slide.title, [[24, 72], [60, 56], [999, 44]]) }}>{slide.title}</h2>
        {slide.subtitle ? <p className="deck-subtitle">{slide.subtitle}</p> : null}
        {slide.text ? <p className="deck-intro">{slide.text}</p> : null}
      </div>
      <ol className="deck-steps" data-long={(slide.bullets ?? []).join("").length > 520 ? "true" : undefined}>
        {(slide.bullets ?? []).map((item, index) => <li key={index}><span className="deck-step-number">{index + 1}</span><span>{item}</span></li>)}
      </ol>
    </div>;
  }
}

function Cover({ slide, deck }: { slide: Slide; deck: Deck }) {
  return <div className="deck-cover">
    <svg className="deck-cover-art" width="620" height="720" viewBox="0 0 620 720" aria-hidden="true">
      <circle cx="470" cy="170" r="300" fill="var(--deck-accent)" />
      {[150, 230, 190, 300, 380].map((barHeight, index) => <rect key={index} x={200 + index * 74} y={660 - barHeight} width="44" height={barHeight + 80} rx="22" fill="var(--deck-fg)" opacity={0.1 + index * 0.13} />)}
    </svg>
    <div className="deck-cover-top">
      <span className="deck-cover-brand"><span className="cozte-logo-mark" aria-hidden="true" />{deck.organization || "Cozte"}</span>
    </div>
    <div className="deck-cover-main">
      <h1 className="deck-heading" style={{ fontSize: fit(slide.title, [[26, 92], [48, 74], [80, 60], [999, 48]]) }}>{slide.title}</h1>
      {slide.subtitle || deck.subtitle ? <p className="deck-subtitle">{slide.subtitle || deck.subtitle}</p> : null}
      {slide.text ? <p className="deck-intro">{slide.text}</p> : null}
    </div>
    <div className="deck-cover-bottom">
      <span className="deck-pill">{monthLabel(deck.month)}</span>
      {deck.dataAt ? <span>Datos al {dataDate(deck.dataAt)}</span> : null}
    </div>
  </div>;
}

function Header({ slide }: { slide: Slide }) {
  return <header className="deck-header">
    <h2 className="deck-heading" style={{ fontSize: fit(slide.title, [[40, 50], [70, 42], [999, 34]]) }}>{slide.title}</h2>
    {slide.subtitle ? <p className="deck-subtitle-sm">{slide.subtitle}</p> : null}
  </header>;
}

function Bullets({ items, compact }: { items: string[]; compact?: boolean }) {
  const length = items.join("").length;
  const size = compact ? (length > 420 ? 20 : 24) : length > 700 ? 22 : length > 420 ? 26 : 30;
  return <ul className="deck-bullets" style={{ fontSize: size }}>
    {items.map((item, index) => <li key={index}><span className="deck-bullet-mark" aria-hidden="true" />{item}</li>)}
  </ul>;
}

function ChartSlide({ slide, deck }: { slide: Slide; deck: Deck }) {
  const chart = slide.chart;
  const takeaway = slide.text ?? chart?.insight ?? null;
  const side = Boolean(takeaway || slide.bullets?.length);
  const width = side ? 780 : 1136;
  const height = slide.subtitle ? 424 : 448;
  return <div className="deck-pad">
    <Header slide={slide} />
    <div className="deck-chart-row">
      <figure className="deck-figure" style={{ width }}>
        {chart ? <DeckChart data={chart.data} width={width} height={height} currency={deck.currency} /> : null}
        {chart?.caption ? <figcaption>{chart.caption}</figcaption> : null}
      </figure>
      {side ? <aside className="deck-aside">
        <span className="deck-aside-label">Lo importante</span>
        {takeaway ? <p style={{ fontSize: takeaway.length > 220 ? 21 : 25 }}>{takeaway}</p> : null}
        {slide.bullets?.length ? <Bullets items={slide.bullets} compact /> : null}
      </aside> : null}
    </div>
  </div>;
}

/** A slide scaled to its container's width (or to fit both sides), keeping the 16:9 canvas intact. */
export function ScaledSlide({ fit: mode = "width", className, ...props }: SlideProps & { fit?: "width" | "contain"; className?: string }) {
  const container = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(mode === "contain" ? Math.min(width / SLIDE_WIDTH, height / SLIDE_HEIGHT) : width / SLIDE_WIDTH);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);
  return <div ref={container} className={className} style={mode === "width" ? { width: "100%", aspectRatio: "16 / 9", position: "relative", overflow: "hidden" } : { position: "relative", overflow: "hidden", display: "grid", placeItems: "center" }}>
    <div style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale, visibility: scale ? "visible" : "hidden" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
        <SlideView {...props} />
      </div>
    </div>
  </div>;
}

/** Every slide at native size, one per printed page: "Descargar PDF" prints this. */
export function PrintDeck({ deck, title, theme }: { deck: Deck; title: string; theme: DeckTheme }) {
  return <div className="deck-print" aria-hidden="true">
    {deck.slides.map((slide, index) => <div key={slide.id} className="deck-print-page"><SlideView slide={slide} index={index} total={deck.slides.length} deck={deck} title={title} theme={theme} /></div>)}
  </div>;
}
