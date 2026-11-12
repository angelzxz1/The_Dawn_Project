import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/content/guides";
import { Container, CtaBand, PageIntro, sunBands } from "@/site/ui";

export const metadata: Metadata = {
  title: "Guides",
  description: "Detailed guides to The Dawn Project's instruments and effects: what every section and knob is for, and how to use it.",
};

const MARK = sunBands(13, 13, 12, [
  [5.6, 1.1],
  [9, 1.5],
]);

/** A guide as the printed manual that comes with a piece of gear: cream
 * paper, stapled at the spine, the name big on its cover. */
function Manual({ slug, name, kind, summary }: { slug: string; name: string; kind: string; summary: string }) {
  return (
    <Link
      href={`/guides/${slug}`}
      className="group relative flex min-h-[360px] flex-col gap-4 rounded-[3px] bg-[linear-gradient(100deg,#e3d8c2_0,#f1e8d6_14px,#efe6d3_60%,#e9dfca)] py-8 pl-12 pr-8 text-[#2a241b] no-underline shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_2px_0_#b9ad95,0_4px_0_#a69a82,0_20px_40px_-12px_rgba(0,0,0,0.8)] transition-transform duration-200 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {/* The staples, and the fold of the spine. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-5 w-px bg-[#c9bda5]" />
      <span aria-hidden="true" className="absolute left-[17px] top-[22%] h-7 w-[7px] rounded-[2px] border border-[#8b8780] bg-[linear-gradient(90deg,#d6d4d0,#9d9a94)]" />
      <span aria-hidden="true" className="absolute bottom-[22%] left-[17px] h-7 w-[7px] rounded-[2px] border border-[#8b8780] bg-[linear-gradient(90deg,#d6d4d0,#9d9a94)]" />
      <span className="flex items-center gap-2 text-[14px] font-semibold text-[#5a4f3f]">
        <svg width="22" height="12" viewBox="0 0 26 14" aria-hidden="true">
          <path d={MARK} fill="#b5762a" />
        </svg>
        The Dawn Project
      </span>
      <span className="pt-6 text-[15px] font-semibold text-[#8a5a1c]">{kind} guide</span>
      <span className="-mt-2 font-display text-[clamp(40px,4vw,52px)] font-bold leading-none tracking-[-0.02em]">{name}</span>
      <span className="max-w-[360px] text-[16px] leading-[1.6] text-[#4a4134]">{summary}</span>
      <span className="mt-auto pt-4 text-[16px] font-semibold text-[#2a241b] underline decoration-[#b5762a] decoration-2 underline-offset-4 group-hover:decoration-[#2a241b]">
        Read the guide
      </span>
    </Link>
  );
}

export default function GuidesPage() {
  return (
    <>
      <PageIntro
        title="Every knob, explained."
        lead="In-depth tutorials for Dawn's instruments and effects: what each section is for, what every knob does, and recipes to get you started. More guides are on the way."
      />

      <section aria-label="Guides" className="pt-[72px]">
        <Container className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((g) => (
            <Manual key={g.slug} slug={g.slug} name={g.name} kind={g.kind} summary={g.summary} />
          ))}
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
