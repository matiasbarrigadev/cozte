"use client";

import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
const allowedElements = ["p", "strong", "em", "del", "a", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td", "br", "input"];

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>,
  h1: ({ children }) => <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
  // Cozte uses a blockquote for its short "Para entender" tip; it reads as a highlighted note.
  blockquote: ({ children }) => <blockquote className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-foreground [&_p]:mt-0">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{children}</code>,
  pre: ({ children }) => <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-background p-3 text-xs">{children}</pre>,
  table: ({ children }) => <table className="mt-2 w-full border-collapse text-left text-xs [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">{children}</table>,
  hr: () => <hr className="my-3 border-border" />,
};

/** Cozte answers in Spanish; stray words in another script (a known model artifact) are removed before rendering. */
export function withoutForeignScript(text: string): string {
  return text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, "").replace(/[ \t]{2,}/g, " ");
}

export const AssistantMarkdown = React.memo(function AssistantMarkdown({ text }: { text: string }) {
  return <div className="min-w-0 overflow-x-auto break-words"><Markdown remarkPlugins={plugins} allowedElements={allowedElements} components={components}>{withoutForeignScript(text)}</Markdown></div>;
});
