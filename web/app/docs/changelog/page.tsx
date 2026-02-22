import { compileMDX } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import { shikiOptions } from "@/lib/shiki-config";
import { mdxComponents } from "@/lib/mdx-components";

export const metadata = {
  title: "Changelog - TileForge Docs",
  description: "TileForge release notes and changelog.",
};

async function fetchChangelog(): Promise<string> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/thesandybridge/tileforge/releases",
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) throw new Error("Failed to fetch releases");
    const releases = await res.json();

    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error("No releases");
    }

    const md = releases
      .slice(0, 20)
      .map(
        (r: { name?: string; tag_name: string; published_at: string; body?: string }) =>
          `## ${r.name || r.tag_name}\n\n*${new Date(r.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}*\n\n${r.body || "No release notes."}`
      )
      .join("\n\n---\n\n");

    return `# Changelog\n\n${md}`;
  } catch {
    return `# Changelog\n\nNo releases available yet. Check back soon!`;
  }
}

export default async function ChangelogDocsPage() {
  const source = await fetchChangelog();

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
