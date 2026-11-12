"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startTelemetry } from "@/services/telemetry";
import { supportLink } from "./siteLinks";
import { Container, Logo, OpenDawn, PilotLamp } from "./ui";

const NAV: [string, string][] = [
  ["/features", "Features"],
  ["/how-it-works", "How it works"],
  ["/guides", "Guides"],
  ["/faq", "FAQ"],
  ["/support", "Support"],
];

const isCurrent = (path: string, href: string) => path === href || path === `${href}/`;

const openButton =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-md bg-accent px-[18px] text-[15px] font-semibold text-on-accent no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-2px_0_rgba(0,0,0,0.22),0_2px_0_rgba(0,0,0,0.5)] transition-colors hover:bg-accent-strong active:translate-y-px";

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

/** The site's header: the logo, the pages and Open Dawn; on a phone the
 * pages are behind a Menu button. */
export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Counts visits to the site too, under the same switch and rules as the app.
    startTelemetry();
  }, []);
  // The menu closes on a new page, on Escape and on a click outside it.
  const [shownFor, setShownFor] = useState(path);
  if (shownFor !== path) {
    setShownFor(path);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative border-b border-black/50 shadow-[0_1px_0_rgba(255,255,255,0.04)]">
      <Container className="flex items-center justify-between gap-4 py-3.5">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1">
          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map(([href, label]) => {
              const current = isCurrent(path, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={current ? "page" : undefined}
                    className={`relative flex min-h-11 items-center px-3 text-[15px] no-underline transition-colors hover:text-foreground ${current ? "font-semibold text-foreground" : "text-soft"}`}
                  >
                    {label}
                    {current && <span aria-hidden="true" className="absolute inset-x-3 bottom-1.5 h-0.5 rounded-full bg-accent" />}
                  </Link>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="site-menu"
            className="faceplate flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong px-3 text-[15px] text-foreground md:hidden"
          >
            <MenuIcon open={open} />
            <span>Menu</span>
          </button>
          <span className="ml-2 hidden sm:inline-flex">
            <OpenDawn className={openButton}>
              <PilotLamp className="bg-[#fff1d6] shadow-[0_0_0_1.5px_rgba(0,0,0,0.3)]" />
              Open Dawn
            </OpenDawn>
          </span>
        </nav>
      </Container>
      {open && (
        <div id="site-menu" className="faceplate absolute inset-x-0 top-full z-50 border-b border-border-strong shadow-[0_24px_40px_-12px_rgba(0,0,0,0.8)] md:hidden">
          <Container className="flex flex-col py-3">
            <ul className="flex flex-col">
              {NAV.map(([href, label]) => {
                const current = isCurrent(path, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-12 items-center border-b border-border text-[17px] no-underline ${current ? "font-semibold text-accent" : "text-foreground"}`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <OpenDawn className={`${openButton} mt-4 min-h-12 sm:hidden`} />
          </Container>
        </div>
      )}
    </div>
  );
}

export function SiteFooter() {
  const links: [string, string][] = [
    ["/features", "Features"],
    ["/how-it-works", "How it works"],
    ["/guides", "Guides"],
    ["/faq", "FAQ"],
    ["/support", "Support"],
    ["/credits", "Credits"],
    ["/license", "License"],
    ["/privacy", "Privacy"],
  ];
  const discord = supportLink("discord");
  return (
    <div className="mt-24 border-t border-black/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <Container className="flex flex-wrap items-start justify-between gap-8 py-12">
        <div className="flex max-w-[340px] flex-col gap-2">
          <Logo />
          <p className="text-[15px] leading-relaxed text-muted">A free studio in your browser, built by Angel, one developer. © 2026</p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-10 gap-y-1 sm:grid-cols-3">
            {links.map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="flex min-h-10 items-center text-[15px] text-soft no-underline hover:text-foreground">
                  {label}
                </Link>
              </li>
            ))}
            {discord && (
              <li>
                <a href={discord} target="_blank" rel="noreferrer" className="flex min-h-10 items-center text-[15px] text-soft no-underline hover:text-foreground">
                  Discord
                </a>
              </li>
            )}
          </ul>
        </nav>
      </Container>
    </div>
  );
}
