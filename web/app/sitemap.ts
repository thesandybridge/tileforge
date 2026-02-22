import type { MetadataRoute } from "next";
import { DOC_SECTIONS } from "@/lib/docs-nav";

const siteUrl = "https://tileforge.sandybridge.io";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: `${siteUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/gallery`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/changelog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
    { url: `${siteUrl}/docs`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/docs/changelog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
  ];

  const docPages: MetadataRoute.Sitemap = DOC_SECTIONS.map(({ slug }) => ({
    url: `${siteUrl}/docs/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...docPages];
}
