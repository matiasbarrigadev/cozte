"use client";

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
  blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
  code: ({ children }) => <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">{children}</code>,
  pre: ({ children }) => <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-background p-3 text-xs">{children}</pre>,
  table: ({ children }) => <table className="mt-2 w-full border-collapse text-left text-xs [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">{children}</table>,
  hr: () => <hr className="my-3 border-border" />,
};

export function AssistantMarkdown({ text }: { text: string }) {
  return <div className="min-w-0 overflow-x-auto break-words"><Markdown remarkPlugins={plugins} allowedElements={allowedElements} components={components}>{text}</Markdown></div>;
}
