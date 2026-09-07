import { MarketingHeader, MarketingFooter } from "@/components/brand";
import { Button } from "@/components/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />
      <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-28 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">404</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-4 text-muted">
          The page you are looking for does not exist or has moved. Head back to the
          homepage to keep going.
        </p>
        <Link href="/" className="mt-8">
          <Button>Back to home</Button>
        </Link>
      </section>
      <MarketingFooter />
    </div>
  );
}
