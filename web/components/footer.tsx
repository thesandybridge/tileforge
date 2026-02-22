import Link from "next/link";
import { Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-border/50 mt-auto border-t">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2">
              <svg viewBox="0 0 32 32" className="text-primary h-6 w-6" aria-hidden>
                <rect x="5" y="5" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="18" y="5" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="5" y="18" width="9" height="9" rx="2" fill="currentColor" />
                <rect x="19" y="19" width="7.5" height="7.5" rx="2" fill="currentColor" opacity="0.5" />
              </svg>
              <span className="font-[family-name:var(--font-geist-mono)] text-primary text-sm font-medium">
                tileforge
              </span>
            </Link>
            <p className="text-muted-foreground mt-3 max-w-xs text-sm">
              Transform images into map tiles. Fast, open-source, and runs in your browser.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="text-foreground mb-3 text-sm font-medium">Product</h3>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link href="/gallery" className="hover:text-foreground transition-colors">
                  Gallery
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-foreground transition-colors">
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="hover:text-foreground transition-colors">
                  Changelog
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-foreground transition-colors">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>

          {/* Connect */}
          <div>
            <h3 className="text-foreground mb-3 text-sm font-medium">Connect</h3>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <a
                  href="https://github.com/thesandybridge/tileforge"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-2 transition-colors"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href="https://sandybridge.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  sandybridge.io
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="text-muted-foreground mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-8 text-sm md:flex-row">
          <p>&copy; {new Date().getFullYear()} sandybridge. All rights reserved.</p>
          <p className="text-muted-foreground/60 text-xs">
            Built with Next.js, Rust, and WebAssembly
          </p>
        </div>
      </div>
    </footer>
  );
}
