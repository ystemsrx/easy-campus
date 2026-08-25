interface MarkdownOptions {
  accentColor?: string;
  compact?: boolean;
  mediaUrls?: Record<string, string>;
  theme?: "light" | "dark";
}

export type MarkdownBlock =
  | { key: string; type: "rich"; html: string }
  | {
      key: string;
      type: "code";
      code: string;
      language: string;
      lines: Array<{ key: string; text: string }>;
      contentHeightRpx: number;
      compactContentHeightRpx: number;
    };

const MEDIA_PATTERN =
  /^media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeAccent(value?: string): string {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? String(value) : "#1677ff";
}

function inlineMarkdown(
  source: string,
  accent: string,
  mediaUrls: Record<string, string>,
): string {
  const tokens: string[] = [];
  const token = (html: string): string => {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  };

  let value = source.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, rawAlt: string, rawUrl: string) => {
      const mediaMatch = MEDIA_PATTERN.exec(rawUrl.trim());
      if (!mediaMatch) return token(escapeHtml(`[图片：${rawAlt || "图片"}]`));
      const path = mediaUrls[mediaMatch[1].toLowerCase()];
      if (!path) {
        return token(
          `<span style="display:block;margin:16px 0;padding:18px;border-radius:14px;color:#8a94a6;background:#f1f4f8;text-align:center;">图片暂时无法显示</span>`,
        );
      }
      return token(
        `<img src="${escapeHtml(path)}" alt="${escapeHtml(rawAlt)}" style="display:block;width:100%;max-width:100%;height:auto;margin:16px 0;border-radius:14px;" />`,
      );
    },
  );

  value = escapeHtml(value);
  value = value.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label: string, url: string) =>
      token(
        `<a href="${escapeHtml(url)}" style="color:${accent};text-decoration:none;">${label}</a>`,
      ),
  );
  value = value
    .replace(
      /`([^`\n]+)`/g,
      '<code style="padding:2px 6px;border-radius:6px;background:rgba(127,127,127,.12);font-family:monospace;">$1</code>',
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1$2");
  return value.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
    return tokens[Number(index)] || "";
  });
}

export function renderMarkdown(
  markdown: string,
  options: MarkdownOptions = {},
): string {
  const dark = options.theme === "dark";
  const textColor = dark ? "#ddd5c7" : "#263247";
  const codeBackground = dark ? "#39352e" : "#f0ede7";
  const codeBorder = dark ? "#4a453d" : "#e2ddd3";
  return renderMarkdownBlocks(markdown, options)
    .map((block) => {
      if (block.type === "rich") return block.html;
      return `<div style="margin:0 0 14px;overflow:hidden;border:1px solid ${codeBorder};border-radius:12px;background:${codeBackground};"><div style="padding:9px 14px;border-bottom:1px solid ${codeBorder};color:${dark ? "#b8ae9e" : "#7b7368"};font-family:monospace;font-size:12px;font-weight:700;">${escapeHtml(block.language)}</div><pre style="margin:0;padding:14px;overflow:auto;color:${textColor};font-family:monospace;white-space:pre;">${escapeHtml(block.code)}</pre></div>`;
    })
    .join("");
}

export function renderMarkdownBlocks(
  markdown: string,
  options: MarkdownOptions = {},
): MarkdownBlock[] {
  const accent = safeAccent(options.accentColor);
  const mediaUrls = options.mediaUrls || {};
  const dark = options.theme === "dark";
  const textColor = dark ? "#ddd5c7" : "#263247";
  const headingColor = dark ? "#f7f3e9" : "#172033";
  const mutedColor = dark ? "#b8ae9e" : "#657086";
  const mutedBackground = dark ? "#39352e" : "#f4f6fa";
  const bodyFontSize = options.compact ? 14 : 15;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let richBlocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: { language: string; lines: string[] } | null = null;

  const flushRichBlocks = () => {
    if (!richBlocks.length) return;
    blocks.push({
      key: `block-${blocks.length}`,
      type: "rich",
      html: `<div style="color:${textColor};font-size:${bodyFontSize}px;line-height:1.72;overflow-wrap:anywhere;">${richBlocks.join("")}</div>`,
    });
    richBlocks = [];
  };
  const flushCode = () => {
    if (!code) return;
    flushRichBlocks();
    const codeValue = code.lines.join("\n");
    blocks.push({
      key: `block-${blocks.length}`,
      type: "code",
      code: codeValue,
      language: code.language,
      lines: code.lines.map((line, index) => ({
        key: `line-${index}`,
        text: line.replace(/\t/g, "    ").replace(/ /g, "\u00a0") || "\u00a0",
      })),
      contentHeightRpx: 48 + Math.max(1, code.lines.length) * 37,
      compactContentHeightRpx: 36 + Math.max(1, code.lines.length) * 33,
    });
    code = null;
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    richBlocks.push(
      `<p style="margin:0 0 14px;line-height:1.72;">${paragraph
        .map((line) => inlineMarkdown(line, accent, mediaUrls))
        .join("<br />")}</p>`,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    richBlocks.push(
      `<${tag} style="margin:0 0 14px;padding-left:22px;line-height:1.72;">${list.items
        .map((item) => `<li>${inlineMarkdown(item, accent, mediaUrls)}</li>`)
        .join("")}</${tag}>`,
    );
    list = null;
  };

  for (const line of lines) {
    if (code && line.trim().startsWith("```")) {
      flushCode();
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    const fence = line.trim().match(/^```\s*([^\s`]*)/);
    if (fence) {
      flushParagraph();
      flushList();
      flushRichBlocks();
      code = { language: fence[1] || "plaintext", lines: [] };
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const size = [0, 24, 21, 18, 16][level];
      richBlocks.push(
        `<h${level} style="margin:${level === 1 ? 0 : 8}px 0 12px;color:${headingColor};font-size:${size}px;line-height:1.35;">${inlineMarkdown(heading[2], accent, mediaUrls)}</h${level}>`,
      );
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      richBlocks.push(
        `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid ${accent};border-radius:0 10px 10px 0;color:${mutedColor};background:${mutedBackground};line-height:1.65;">${inlineMarkdown(quote[1], accent, mediaUrls)}</blockquote>`,
      );
      continue;
    }
    const unordered = /^[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((ordered || unordered)?.[1] || "");
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushCode();
  flushParagraph();
  flushList();
  flushRichBlocks();
  return blocks;
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, (value) => value.replace(/```[^\n]*/g, ""))
    .replace(/^[#>*+\-\d.)\s]+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
