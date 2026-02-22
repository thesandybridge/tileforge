import fs from "fs/promises";
import path from "path";
import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import { shikiOptions } from "@/lib/shiki-config";
import { mdxComponents } from "@/lib/mdx-components";

export const metadata = {
  title: "Documentation - TileForge",
  description: "TileForge documentation - learn how to transform images into map tiles.",
};

export default async function DocsPage() {
  const filePath = path.join(process.cwd(), "content/docs/index.mdx");
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
}
