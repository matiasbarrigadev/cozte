import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeckPlayer } from "@/components/decks/deck-player";
import { monthLabel, type Presentation } from "@/lib/decks";
import { loadSharedPresentation } from "@/lib/server/presentations";

const load = cache(async (token: string): Promise<Presentation | null> => {
  const presentation = await loadSharedPresentation(token).catch(() => null);
  // Speaker notes are for whoever presents; a public link never carries them.
  return presentation ? { ...presentation, deck: { ...presentation.deck, slides: presentation.deck.slides.map((slide) => ({ ...slide, notes: undefined })) } } : null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const presentation = await load((await params).token);
  if (!presentation) return { title: "Presentación no disponible | Cozte", robots: { index: false, follow: false } };
  const description = [presentation.deck.organization, monthLabel(presentation.deck.month), `${presentation.deck.slides.length} diapositivas`].filter(Boolean).join(" · ");
  return {
    title: `${presentation.title} | Cozte`, description,
    // Shared by link only: it should not appear in search engines.
    robots: { index: false, follow: false },
    openGraph: { title: presentation.title, description, siteName: "Cozte", type: "website" },
  };
}

/** A presentation shared with a public link: anyone with it can view it, no account needed. */
export default async function SharedPresentation({ params }: { params: Promise<{ token: string }> }) {
  const presentation = await load((await params).token);
  if (!presentation) notFound();
  return <DeckPlayer presentation={presentation} />;
}
