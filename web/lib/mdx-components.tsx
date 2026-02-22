import React from "react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const el = node as { props: { children?: React.ReactNode } };
    return extractText(el.props.children);
  }
  return "";
}

export function CalloutCard({
  title,
  children,
  variant = "info",
}: {
  title?: string;
  children: React.ReactNode;
  variant?: "info" | "warning" | "tip";
}) {
  const styles = {
    info: "border-blue-500/30 bg-blue-500/5",
    warning: "border-yellow-500/30 bg-yellow-500/5",
    tip: "border-green-500/30 bg-green-500/5",
  };

  return (
    <div className={`my-6 rounded-lg border p-4 ${styles[variant]}`}>
      {title && <p className="mb-2 font-semibold">{title}</p>}
      <div className="text-sm [&>p]:mb-0">{children}</div>
    </div>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 grid gap-4 sm:grid-cols-2">{children}</div>
  );
}

export function MiniCard({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  const content = (
    <div className="border-border bg-card hover:border-primary/30 rounded-lg border p-4 transition-colors">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <div className="text-muted-foreground text-sm">{children}</div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export const mdxComponents = {
  CalloutCard,
  CardGrid,
  MiniCard,
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2
      className="text-foreground mt-10 mb-4 scroll-mt-20 text-2xl font-bold tracking-tight"
      {...props}
    />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3
      className="text-foreground mt-8 mb-3 scroll-mt-20 text-xl font-semibold tracking-tight"
      {...props}
    />
  ),
  h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4
      className="text-foreground mt-6 mb-2 scroll-mt-20 text-lg font-semibold"
      {...props}
    />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-muted-foreground mb-4 leading-7" {...props} />
  ),
  pre: (props: React.ComponentPropsWithoutRef<"pre">) => {
    const text = extractText(props.children);
    return (
      <div className="relative group my-4">
        <pre {...props} />
        <CopyButton text={text} />
      </div>
    );
  },
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-6 overflow-x-auto">
      <table className="w-full text-sm" {...props} />
    </div>
  ),
  thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="border-border border-b" {...props} />
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="text-foreground px-4 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="text-muted-foreground border-border border-t px-4 py-2" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="text-muted-foreground my-4 ml-6 list-disc space-y-2" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="text-muted-foreground my-4 ml-6 list-decimal space-y-2" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-7" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="text-muted-foreground border-primary/30 my-6 border-l-4 pl-4 italic"
      {...props}
    />
  ),
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="border-border my-8" {...props} />
  ),
  a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    if (href?.startsWith("/")) {
      return (
        <Link href={href} className="text-primary hover:underline" {...props} />
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline"
        {...props}
      />
    );
  },
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="text-foreground font-semibold" {...props} />
  ),
};
