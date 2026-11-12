import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/site/SiteChrome";
import { CabinetCorners, Container, OpenDawn, Screws, Sun, h1Class, leadClass, secondaryButton } from "@/site/ui";
import { siteFontVariables } from "@/site/siteFonts";

export const metadata: Metadata = {
  title: "Page not found",
};

/** Any address that isn't a page (exported as 404.html, which the host serves). */
export default function NotFound() {
  return (
    <div className={`site ${siteFontVariables} flex min-h-screen w-full flex-1 flex-col`}>
      <header>
        <SiteHeader />
      </header>
      <main className="flex-1">
        {/* The amp from the foot of every page, switched off: lamp dark, the
            sun dim behind the grille. */}
        <Container className="pt-[clamp(32px,6vw,72px)]">
          <div className="relative rounded-lg bg-[#121114] p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
            <CabinetCorners />
            <div className="faceplate relative flex flex-col items-center gap-6 rounded-t px-6 pb-12 pt-[clamp(44px,7vw,80px)] text-center">
              <Screws />
              <span aria-hidden="true" className="size-2.5 rounded-full bg-[#3b2f20] shadow-[inset_0_1px_2px_rgba(0,0,0,0.7)]" />
              <h1 className={`${h1Class} max-w-[760px]`}>This page isn&rsquo;t here.</h1>
              <p className={`${leadClass} max-w-[520px]`}>The address may be mistyped, or the page has moved. Your projects are safe: they live on your computer.</p>
              <div className="flex flex-wrap justify-center gap-3">
                <OpenDawn />
                <Link href="/" className={secondaryButton}>
                  Go to the home page
                </Link>
              </div>
            </div>
            <div className="piping" />
            <div className="grille flex justify-center rounded-b px-6 pt-10">
              <div className="w-[min(520px,90%)] opacity-25 grayscale-[0.4]">
                <Sun />
              </div>
            </div>
          </div>
        </Container>
      </main>
      <footer>
        <SiteFooter />
      </footer>
    </div>
  );
}
