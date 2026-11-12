// Building blocks shared by the website's pages: layout, type, buttons and
// the gear they're dressed as (faceplates, screws, an amp cabinet's corner
// protectors), and the dawn motif (a striped half sun).

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { APP_PATH } from "./siteLinks";

export function Container({ className = "", children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,40px)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** A small label naming what a section is about. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[15px] font-semibold text-accent ${className}`}>{children}</p>;
}

export const h1Class = "font-display text-[clamp(42px,6.4vw,80px)] font-bold leading-none tracking-[-0.02em] text-foreground text-balance";
export const h2Class = "font-display text-[clamp(32px,4vw,48px)] font-bold leading-[1.06] tracking-[-0.015em] text-foreground text-balance";
export const leadClass = "text-[17px] leading-[1.6] text-soft";

// Buttons are hardware: lit from above, pressed in when pushed.
const buttonBase =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2.5 rounded-md text-[16px] no-underline transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px";
export const primaryButton = `${buttonBase} bg-accent px-6 font-semibold text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-2px_0_rgba(0,0,0,0.22),0_2px_0_rgba(0,0,0,0.5),0_0_24px_-6px_rgba(230,173,94,0.55)] hover:bg-accent-strong active:shadow-[inset_0_2px_3px_rgba(0,0,0,0.3)]`;
export const secondaryButton = `${buttonBase} faceplate border border-border-strong px-[22px] font-medium text-foreground hover:border-metal-hi`;
/** A text link that leads somewhere (in place of a button). */
export const textLink = "text-[16px] font-semibold text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent";

/** A screw, as on a faceplate's corners. */
export function Screw({ className = "" }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="5" cy="5" r="4.5" fill="#6a6971" stroke="#141316" strokeWidth="1" />
      <path d="M2.4 6.2 7.6 3.8" stroke="#2a292e" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Four screws in a panel's corners (the panel is `relative`). */
export function Screws() {
  return (
    <>
      <Screw className="absolute left-2.5 top-2.5" />
      <Screw className="absolute right-2.5 top-2.5 rotate-90" />
      <Screw className="absolute bottom-2.5 left-2.5 rotate-45" />
      <Screw className="absolute bottom-2.5 right-2.5 -rotate-12" />
    </>
  );
}

function Corner({ className }: { className: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className={`pointer-events-none absolute z-10 ${className}`}>
      <defs>
        <linearGradient id="corner-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#cfcdd5" />
          <stop offset="0.5" stopColor="#8d8b94" />
          <stop offset="1" stopColor="#57565e" />
        </linearGradient>
      </defs>
      <path d="M6 0h28v9H9v25H0V6a6 6 0 0 1 6-6z" fill="url(#corner-metal)" />
      <circle cx="4.6" cy="4.6" r="1.5" fill="#3d3c43" />
    </svg>
  );
}

/** An amp cabinet's metal corner protectors, on a `relative` box. */
export function CabinetCorners() {
  return (
    <>
      <Corner className="-left-1 -top-1" />
      <Corner className="-right-1 -top-1 rotate-90" />
      <Corner className="-bottom-1 -right-1 rotate-180" />
      <Corner className="-bottom-1 -left-1 -rotate-90" />
    </>
  );
}

/** A pilot lamp: lit amber, as on an amp that's on. */
export function PilotLamp({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full bg-[#ffd08a] shadow-[0_0_0_2px_rgba(0,0,0,0.35),0_0_10px_2px_rgba(255,176,77,0.75)] ${className}`} />;
}

export function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-accent">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** "Open Dawn": the studio, opened in this tab. */
export function OpenDawn({ className = primaryButton, children = "Open Dawn" }: { className?: string; children?: ReactNode }) {
  return (
    <a href={APP_PATH} className={className}>
      {children}
    </a>
  );
}

/** A list of points with check marks; `strong` leads each in bold. */
export function CheckList({ items, className = "" }: { items: { strong?: string; text: ReactNode }[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-3.5 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-[16px] leading-normal text-soft">
          <span className="pt-0.5">
            <CheckIcon />
          </span>
          <span>
            {item.strong && <strong className="font-semibold text-foreground">{item.strong}</strong>} {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

const STRIPES: [number, number][] = [
  [35.3, 7.6],
  [86.3, 10.3],
  [141.7, 12.5],
  [202.5, 17.9],
  [270.9, 22.8],
  [344.7, 33.1],
];

/** A half sun (center `cx`, horizon `base`, radius `r`) with `stripes`
 * ([top, height]) left out: the bands between them, as one path. The
 * stripes are gaps, so whatever is behind the sun shows through them. */
export function sunBands(cx: number, base: number, r: number, stripes: [number, number][]): string {
  const half = (y: number) => Math.sqrt(Math.max(0, r * r - (base - y) * (base - y)));
  const f = (v: number) => Math.round(v * 100) / 100;
  const edges = [base - r, ...stripes.flat().map((v, i) => (i % 2 ? stripes[(i - 1) / 2][0] + v : v)), base];
  const bands: string[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const [top, bottom] = [edges[i], edges[i + 1]];
    const [wt, wb] = [half(top), half(bottom)];
    bands.push(
      `M${f(cx - wt)} ${f(top)}H${f(cx + wt)}A${r} ${r} 0 0 1 ${f(cx + wb)} ${f(bottom)}H${f(cx - wb)}A${r} ${r} 0 0 1 ${f(cx - wt)} ${f(top)}Z`,
    );
  }
  return bands.join("");
}

const SUN_PATH = sunBands(380, 380, 380, STRIPES);
const LOGO_PATH = sunBands(13, 13, 12, [
  [5.6, 1.1],
  [9, 1.5],
]);

/** The dawn: a half sun whose stripes widen toward the horizon. */
export function Sun({ className = "" }: { className?: string }) {
  return (
    <svg width="100%" viewBox="0 0 760 380" preserveAspectRatio="xMidYMax meet" aria-hidden="true" className={`block ${className}`}>
      <path d={SUN_PATH} className="fill-accent" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" aria-label="The Dawn Project home" className="flex min-h-11 items-center gap-2.5 no-underline">
      <svg width="28" height="15" viewBox="0 0 26 14" aria-hidden="true">
        <path d={LOGO_PATH} className="fill-accent" />
      </svg>
      <span className="font-display text-[20px] font-bold tracking-[-0.01em] text-foreground">The Dawn Project</span>
    </Link>
  );
}

/** A page's opening: eyebrow, big heading, lead and optional extras. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <Container className="flex flex-col gap-[22px] pt-[clamp(40px,6vw,80px)]">
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h1 className={`${h1Class} max-w-[940px]`}>{title}</h1>
      <p className={`${leadClass} max-w-[680px] text-[clamp(17px,1.6vw,20px)]`}>{lead}</p>
      {children}
    </Container>
  );
}

/** Jump links to a page's sections, as pills. */
export function JumpLinks({ label, links }: { label: string; links: [string, string][] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 pt-2.5">
      {links.map(([href, text]) => (
        <a key={href} href={href} className="faceplate flex min-h-11 items-center rounded-md border border-border-strong px-4 text-[15px] text-foreground no-underline hover:border-accent">
          {text}
        </a>
      ))}
    </nav>
  );
}

/** A section heading block: eyebrow, h2 and an optional lead. */
export function SectionHead({ id, eyebrow, title, lead, className = "" }: { id?: string; eyebrow?: string; title: string; lead?: ReactNode; className?: string }) {
  return (
    <div className={`flex max-w-[680px] flex-col gap-3.5 ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 id={id} className={h2Class}>
        {title}
      </h2>
      {lead && <p className={leadClass}>{lead}</p>}
    </div>
  );
}

/** The closing call to action at the bottom of every page: an amp's front,
 * its badge the sun. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-h" className="pt-[110px]">
      <Container>
        <div className="relative rounded-lg bg-[#121114] p-2 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
          <CabinetCorners />
          <div className="faceplate relative flex flex-col items-center gap-5 rounded-t px-6 pb-10 pt-[clamp(40px,6vw,64px)] text-center">
            <Screws />
            <h2 id="cta-h" className={`${h2Class} text-[clamp(36px,5vw,60px)]`}>
              Plug in. Press record. Share.
            </h2>
            <p className={`${leadClass} max-w-[520px]`}>Open Dawn and turn the idea in your head into a demo you can send tonight.</p>
            <OpenDawn />
          </div>
          <div className="piping" />
          <div className="grille flex justify-center rounded-b px-6 pt-10">
            <div className="w-[min(520px,90%)]">
              <Sun />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** A card: the site's raised panel. */
export const cardClass = "faceplate rounded-lg border border-border";
