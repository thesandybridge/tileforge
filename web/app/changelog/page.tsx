import fs from "fs";
import path from "path";
import { MDXRemote } from "next-mdx-remote/rsc";

interface ChangelogEntry {
  title: string;
  date: string;
  version: string;
  body: string;
}

function parseChangelog(raw: string): ChangelogEntry {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let title = "Untitled";
  let date = "";
  let version = "";
  let body = raw;

  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2].trim();
    const get = (key: string) =>
      fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
    title = get("title") || title;
    date = get("date");
    version = get("version");
  }

  return { title, date, version, body };
}

function loadEntries(): ChangelogEntry[] {
  const dir = path.join(process.cwd(), "changelog");
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
  return files.map((f) => parseChangelog(fs.readFileSync(path.join(dir, f), "utf-8")));
}

const mdxComponents = {
  h2: (props: React.ComponentProps<"h3">) => (
    <h3 className="mt-6 mb-2 text-base font-semibold" {...props} />
  ),
  h3: (props: React.ComponentProps<"h4">) => (
    <h4 className="mt-4 mb-1 text-sm font-semibold" {...props} />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p className="text-muted-foreground mb-3" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="text-muted-foreground mb-3 list-disc space-y-1 pl-5" {...props} />
  ),
  code: (props: React.ComponentProps<"code">) => (
    <code className="bg-muted rounded px-1 py-0.5 text-xs" {...props} />
  ),
  a: (props: React.ComponentProps<"a">) => (
    <a className="text-primary hover:underline" {...props} />
  ),
};

export const metadata = {
  title: "Changelog — TileForge",
  description: "Latest features and improvements in TileForge",
};

export default function ChangelogPage() {
  const entries = loadEntries();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Changelog</h1>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No changelog entries yet.</p>
      ) : (
        <div className="space-y-12">
          {entries.map((entry) => {
            const anchor = entry.version
              ? `v${entry.version.replace(/\./g, "-")}`
              : undefined;
            return (
              <article key={entry.version || entry.title} id={anchor}>
                <header className="mb-4">
                  <h2 className="text-xl font-semibold">
                    {anchor ? (
                      <a href={`#${anchor}`} className="hover:underline">
                        {entry.title}
                      </a>
                    ) : (
                      entry.title
                    )}
                  </h2>
                  {entry.date && (
                    <time className="text-muted-foreground text-sm">{entry.date}</time>
                  )}
                </header>
                <div className="text-sm leading-relaxed">
                  <MDXRemote source={entry.body} components={mdxComponents} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
