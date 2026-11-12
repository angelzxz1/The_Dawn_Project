import type { ReactNode } from "react";
import { Container, sunBands } from "./ui";

const MARK = sunBands(13, 13, 12, [
  [5.6, 1.1],
  [9, 1.5],
]);

/** Credits, License and Privacy: the studio's own texts, printed on the
 * paper that comes in the box (`.paper` recolours them for cream stock). */
export function LegalPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <Container className="flex flex-col gap-10 pb-10 pt-[clamp(40px,6vw,72px)]">
      <h1 className="max-w-[820px] font-display text-[clamp(40px,5.4vw,64px)] font-bold leading-[1.02] tracking-[-0.02em] text-foreground text-balance">{title}</h1>
      <article aria-label={eyebrow} className="paper w-full max-w-[820px] rounded-[3px] px-[clamp(22px,5vw,56px)] pb-[clamp(28px,5vw,56px)] pt-6">
        <header className="mb-8 flex items-center justify-between gap-4 border-b border-border pb-4">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-soft">
            <svg width="22" height="12" viewBox="0 0 26 14" aria-hidden="true">
              <path d={MARK} className="fill-accent" />
            </svg>
            The Dawn Project
          </span>
          <span className="text-[14px] font-semibold text-accent">{eyebrow}</span>
        </header>
        {children}
      </article>
    </Container>
  );
}
