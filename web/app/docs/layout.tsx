import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DocsHeader />
      <div className="mx-auto flex w-full max-w-6xl px-6">
        <DocsSidebar />
        <main className="min-w-0 flex-1 py-8 lg:pl-8">
          {children}
        </main>
      </div>
    </>
  );
}
