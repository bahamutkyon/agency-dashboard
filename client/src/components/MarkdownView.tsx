import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  children: string;
  className?: string;
}

/**
 * Renders Markdown with GFM (tables, strikethrough, task lists). Code blocks
 * get a copy button. Links open in a new tab.
 *
 * Tailwind's `prose` would be ideal but adding @tailwindcss/typography is a
 * dependency we can avoid — just style elements directly.
 */
export function MarkdownView({ children, className = "" }: Props) {
  return (
    <div className={`md-view text-sm leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-600 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-accent underline underline-offset-2 hover:text-violet-400">
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-zinc-700" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-zinc-700 bg-zinc-900 px-2 py-1 font-semibold text-left">{children}</th>
          ),
          td: ({ children }) => <td className="border border-zinc-700 px-2 py-1">{children}</td>,
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) return <code className={className}>{children}</code>;
            return (
              <code className="bg-zinc-900 text-amber-300 px-1.5 py-0.5 rounded text-[0.85em] font-mono">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children }: { children?: any }) {
  const [copied, setCopied] = useState(false);
  const codeText = extractText(children);
  const lang = extractLang(children);

  const copy = async (text?: string) => {
    try {
      await navigator.clipboard.writeText(text ?? codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  // Special-case image-generation prompts — show extra "open in Gemini/ChatGPT"
  // buttons so the user can quickly take the prompt to a web image generator.
  const isImagePrompt = lang === "prompt" || lang === "image-prompt" || lang === "midjourney";

  return (
    <div className="relative my-2 group">
      {lang && (
        <div className="absolute top-0 left-0 px-2 py-0.5 text-[10px] text-zinc-500 font-mono">{lang}</div>
      )}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        {isImagePrompt && (
          <>
            <button
              onClick={async () => {
                await copy();
                window.open("https://gemini.google.com/app", "_blank", "noopener");
              }}
              className="text-[11px] px-2 py-0.5 rounded bg-sky-700/80 hover:bg-sky-600 text-white"
              title="複製 prompt 並開啟 Gemini(在 Gemini 貼上即可生圖)"
            >🎨 Gemini</button>
            <button
              onClick={async () => {
                await copy();
                window.open("https://chatgpt.com/", "_blank", "noopener");
              }}
              className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white"
              title="複製 prompt 並開啟 ChatGPT"
            >🎨 ChatGPT</button>
            <button
              onClick={async () => {
                await copy();
                window.open(`https://www.midjourney.com/imagine?prompt=${encodeURIComponent(codeText)}`, "_blank", "noopener");
              }}
              className="text-[11px] px-2 py-0.5 rounded bg-violet-700/80 hover:bg-violet-600 text-white"
              title="複製 prompt 並開啟 Midjourney"
            >🎨 MJ</button>
          </>
        )}
        <button onClick={() => copy()}
          className="text-[11px] px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300">
          {copied ? "✓ 已複製" : "複製"}
        </button>
      </div>
      <pre className="bg-zinc-950 border border-zinc-800 rounded p-3 pt-5 overflow-x-auto text-xs font-mono text-zinc-200">
        {children}
      </pre>
      {isImagePrompt && (
        <div className="text-[10px] text-zinc-500 mt-1">
          💡 拿到圖後可以拖回對話框,讓 agent 幫你評估是否符合本步驟需求
        </div>
      )}
    </div>
  );
}

function extractText(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children) return extractText(node.props.children);
  return "";
}

function extractLang(node: any): string | null {
  if (Array.isArray(node)) {
    for (const c of node) {
      const l = extractLang(c);
      if (l) return l;
    }
  }
  const cn = node?.props?.className;
  if (typeof cn === "string" && cn.startsWith("language-")) {
    return cn.replace("language-", "");
  }
  return null;
}
