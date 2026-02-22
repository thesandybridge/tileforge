import fs from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import { shikiOptions } from "@/lib/shiki-config";
import { mdxComponents } from "@/lib/mdx-components";
import { DOC_SECTIONS } from "@/lib/docs-nav";

export function generateStaticParams() {
  return DOC_SECTIONS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return {
    title: `${title} - TileForge Docs`,
  };
}

export default async function DocSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const filePath = path.join(process.cwd(), `content/docs/${slug}.mdx`);

  try {
    const source = await fs.readFile(filePath, "utf-8");

    const { content } = await compileMDX({
      source,
      components: mdxComponents,
      options: {
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [rehypeSlug, [rehypeShiki, shikiOptions]],
        },
      },
    });

    return <article className="prose-docs">{content}</article>;
  } catch {
    notFound();
  }
}
