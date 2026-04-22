"use client";

import ReactMarkdown from "react-markdown";

type Props = {
  source: string;
  /** Extra classes on the wrapper (e.g. text size). */
  className?: string;
};

const WRAPPER =
  "nf-chat-md text-inherit [&>*:first-child]:mt-0 [&_p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-0.5 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-600 dark:[&_blockquote]:border-zinc-600 dark:[&_blockquote]:text-zinc-400 [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] dark:[&_code]:bg-white/10 [&_pre]:my-2 [&_pre]:max-h-60 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-zinc-200/80 [&_pre]:bg-zinc-50/90 [&_pre]:p-2 [&_pre]:text-xs dark:[&_pre]:border-zinc-600 dark:[&_pre]:bg-zinc-900/80 [&_strong]:font-semibold [&_em]:italic [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_a]:text-blue-700 [&_a]:underline dark:[&_a]:text-blue-300";

/** CommonMark for player-authored NationForge text only (You bubbles + composer preview). */
export function NationForgeChatMarkdown({ source, className = "" }: Props) {
  const trimmed = source.trim();
  if (!trimmed) return null;
  return (
    <div className={`${WRAPPER} ${className}`.trim()}>
      <ReactMarkdown
        components={{
          a({ href, children, ...rest }) {
            const external =
              typeof href === "string" &&
              (href.startsWith("http://") || href.startsWith("https://"));
            return (
              <a
                href={href}
                {...rest}
                rel={external ? "noopener noreferrer" : undefined}
                target={external ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
