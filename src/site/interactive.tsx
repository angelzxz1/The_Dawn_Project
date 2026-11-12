"use client";

// The website's interactive pieces. Everything they show is in the page's
// HTML from the start (closed answers are hidden, not missing), so it reads
// fine before scripts load and search engines see it all.

import { useEffect, useState, type ReactNode } from "react";
import { FAQ_CATEGORIES, FAQS, type Faq } from "@/content/faq";
import { APP_PATH, supportLink } from "./siteLinks";
import { CheckIcon, Screw } from "./ui";

function PlusIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
      className={`shrink-0 text-accent transition-transform duration-150 ${open ? "rotate-45" : ""}`}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FaqItem({ faq, open, onToggle, showCategory }: { faq: Faq; open: boolean; onToggle: () => void; showCategory?: boolean }) {
  const panel = `faq-${faq.id}`;
  return (
    <div className="border-b border-border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={onToggle}
          className="flex min-h-[60px] w-full items-center gap-4 py-4 text-left"
        >
          <span className="flex flex-1 flex-col gap-1">
            {showCategory && <span className="font-code text-[10px] uppercase tracking-[1px] text-muted">{faq.category}</span>}
            <span className="text-[18px] font-semibold text-foreground">{faq.q}</span>
          </span>
          <PlusIcon open={open} />
        </button>
      </h3>
      <p id={panel} hidden={!open} className="max-w-[680px] pb-5 text-[16px] leading-[1.6] text-soft">
        {faq.a}
      </p>
    </div>
  );
}

/** The landing page's short FAQ: one answer open at a time. */
export function FaqAccordion({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(ids[0]);
  const list = ids.map((id) => FAQS.find((f) => f.id === id)!).filter(Boolean);
  return (
    <div className="border-t border-border">
      {list.map((f) => (
        <FaqItem key={f.id} faq={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? "" : f.id)} />
      ))}
    </div>
  );
}

/** The FAQ page: search, categories and every answer. */
export function FaqBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [open, setOpen] = useState(FAQS[0].id);
  const q = query.trim().toLowerCase();
  const matches = (f: Faq) => !q || `${f.q} ${f.a}`.toLowerCase().includes(q);
  const inCategory = (f: Faq, c: string) => c === "All" || f.category === c;
  const list = FAQS.filter((f) => matches(f) && inCategory(f, category));

  return (
    <>
      <div className="flex max-w-[720px] flex-col gap-3.5 pt-1.5">
        <label htmlFor="faq-search" className="text-[13px] font-semibold text-soft">
          Search the FAQ
        </label>
        <div className="flex min-h-[52px] items-center gap-2.5 rounded-xl border border-border-strong bg-surface px-4 focus-within:border-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="text-muted">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            id="faq-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Try "latency" or "offline"'
            className="min-w-0 flex-1 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-10 pt-12">
        <nav aria-label="FAQ categories" className="flex max-w-[280px] flex-[1_1_220px] flex-col gap-1.5">
          {["All", ...FAQ_CATEGORIES].map((c) => {
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(c)}
                className={`flex min-h-11 items-center justify-between gap-2.5 rounded-[10px] border px-3.5 text-left text-[15px] font-semibold text-foreground ${on ? "border-accent bg-glow" : "border-transparent hover:bg-surface"}`}
              >
                {c}
                <span className={`font-code text-[12px] ${on ? "text-accent" : "text-muted"}`}>{FAQS.filter((f) => matches(f) && inCategory(f, c)).length}</span>
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-[3_1_480px] flex-col">
          {list.length === 0 && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-7">
              <span className="text-[17px] font-semibold text-foreground">No questions match &ldquo;{query}&rdquo;.</span>
              <span className="text-[15px] text-soft">Try another word, or ask in #help on the Discord.</span>
            </div>
          )}
          <div className={list.length ? "border-t border-border" : ""}>
            {list.map((f) => (
              <FaqItem key={f.id} faq={f} showCategory open={open === f.id || (!!q && list.length <= 3)} onToggle={() => setOpen(open === f.id ? "" : f.id)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Features: the effects, filterable by category ---

export interface EffectInfo {
  category: string;
  name: string;
  description: string;
}

/** A rack unit's ear: the strip at each end, screwed to the rails. */
function RackEar() {
  return (
    <span aria-hidden="true" className="flex w-7 shrink-0 flex-col items-center justify-between bg-[linear-gradient(90deg,#1b1a1f,#26252b,#1b1a1f)] py-2.5">
      <Screw />
      <Screw className="rotate-45" />
    </span>
  );
}

/** The effects, as units in a rack, with buttons to show one kind. */
export function EffectsGrid({ categories, effects }: { categories: string[]; effects: EffectInfo[] }) {
  const [category, setCategory] = useState("All");
  const shown = effects.filter((e) => category === "All" || e.category === category);
  return (
    <>
      <div role="group" aria-label="Filter effects by category" className="flex flex-wrap gap-2">
        {["All", ...categories].map((c) => {
          const on = category === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(c)}
              className={`faceplate flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-4 text-[15px] font-semibold transition-colors active:translate-y-px ${on ? "border-accent text-foreground" : "border-border-strong text-soft hover:text-foreground"}`}
            >
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${on ? "bg-[#ffd08a] shadow-[0_0_8px_2px_rgba(255,176,77,0.7)]" : "bg-[#3b2f20] shadow-[inset_0_1px_1px_rgba(0,0,0,0.6)]"}`}
              />
              {c}
              <span className="text-[13px] font-medium tabular-nums text-muted">{c === "All" ? effects.length : effects.filter((e) => e.category === c).length}</span>
            </button>
          );
        })}
      </div>
      <ul
        className="grid gap-2 rounded-lg border border-black/70 bg-[#0e0d10] p-2 shadow-[inset_0_2px_14px_rgba(0,0,0,0.8)] sm:p-3 lg:grid-cols-2"
      >
        {shown.map((e) => (
          <li key={e.name} className="faceplate flex min-h-[84px] overflow-hidden rounded-[3px] border border-black/60">
            <RackEar />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 border-x border-black/40 px-4 py-3">
              <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                <h3 className="font-display text-[20px] font-bold leading-tight text-foreground">{e.name}</h3>
                <span className="text-[13px] text-muted">{e.category}</span>
              </div>
              <p className="text-[15px] leading-snug text-soft">{e.description}</p>
            </div>
            <RackEar />
          </li>
        ))}
        {/* An odd number leaves a slot in the two-column rack: a blank
            panel fills it, vented, as in a real one. */}
        {shown.length % 2 === 1 && (
          <li aria-hidden="true" className="faceplate hidden min-h-[84px] overflow-hidden rounded-[3px] border border-black/60 lg:flex">
            <RackEar />
            <span className="flex flex-1 items-center justify-center gap-2 border-x border-black/40 px-6">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="h-8 w-1.5 rounded-full bg-[#0e0d10] shadow-[inset_0_1px_2px_rgba(0,0,0,0.9),0_1px_0_rgba(255,255,255,0.05)]" />
              ))}
            </span>
            <RackEar />
          </li>
        )}
      </ul>
    </>
  );
}

// --- How it works: the five-step walkthrough ---

export interface WalkStep {
  title: string;
  time: string;
  body: ReactNode;
}

export function Walkthrough({ steps }: { steps: WalkStep[] }) {
  const [step, setStep] = useState(0);
  const last = steps.length - 1;
  const current = steps[step];
  return (
    <div className="flex flex-wrap items-start gap-6">
      <ol className="flex max-w-[340px] flex-[1_1_260px] flex-col gap-2">
        {steps.map((s, i) => {
          const on = i === step;
          const done = i < step;
          return (
            <li key={s.title}>
              <button
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => setStep(i)}
                className={`flex min-h-[60px] w-full items-center gap-3.5 rounded-xl border px-3.5 py-2.5 text-left ${on ? "border-accent bg-glow" : "border-border bg-surface hover:border-border-strong"}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-code text-[12px] ${on || done ? "bg-accent text-background" : "bg-surface-raised text-soft"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex flex-col">
                  <span className="text-[16px] font-semibold text-foreground">{s.title}</span>
                  <span className="text-[13px] text-muted">{s.time}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-5 rounded-2xl border border-border bg-surface p-[clamp(20px,3vw,32px)]" aria-live="polite">
        <div className="flex items-baseline gap-3">
          <span className="font-code text-[13px] text-accent">{String(step + 1).padStart(2, "0")}</span>
          <h3 className="font-display text-[clamp(24px,2.6vw,30px)] font-semibold text-foreground">{current.title}</h3>
        </div>
        {current.body}
        <div className="flex flex-wrap justify-between gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="min-h-11 rounded-[10px] border border-border px-4 text-[15px] font-medium text-foreground hover:border-border-strong disabled:opacity-45"
          >
            ← Previous
          </button>
          <button type="button" onClick={() => setStep(step >= last ? 0 : step + 1)} className="min-h-11 rounded-[10px] bg-accent px-4 text-[15px] font-semibold text-background hover:bg-accent-strong">
            {step >= last ? "Start over" : `Next: ${steps[step + 1].title} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- How it works: guitarist / producer setup guides ---

export interface GuideStep {
  title: string;
  text: string;
}

export function SetupGuides({ guides }: { guides: { id: string; label: string; steps: GuideStep[] }[] }) {
  const [id, setId] = useState(guides[0].id);
  const guide = guides.find((g) => g.id === id) ?? guides[0];
  return (
    <>
      <div role="group" aria-label="Choose a guide" className="flex self-start rounded-xl border border-border bg-surface p-1">
        {guides.map((g) => {
          const on = g.id === id;
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              onClick={() => setId(g.id)}
              className={`min-h-10 rounded-lg px-4 text-[15px] font-semibold ${on ? "bg-accent text-background" : "text-soft hover:text-foreground"}`}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {guide.steps.map((s, i) => (
          <li key={s.title} className="flex gap-3.5 rounded-xl border border-border bg-surface px-[18px] py-[18px]">
            <span className="pt-[3px] font-code text-[12px] text-accent">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex flex-col gap-1.5">
              <span className="text-[16px] font-semibold text-foreground">{s.title}</span>
              <span className="text-[15px] leading-normal text-soft">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

// --- Support: membership tiers ---

export interface Tier {
  name: string;
  /** US dollars a month; 0 is free. */
  price: number;
  blurb: string;
  cta: string;
  perks: string[];
  /** The tier's own Patreon checkout link (see content/tiers.ts); without
   * one, the button opens the Patreon page. */
  join?: string;
}

function TierButton({ tier, highlight }: { tier: Tier; highlight: boolean }) {
  const page = supportLink("patreon");
  // A tier's own link only once Patreon is set up for this deployment.
  const href = page && tier.join && /^https:\/\/(www\.)?patreon\.com\//.test(tier.join) ? tier.join : page;
  const className = `mt-auto flex min-h-12 items-center justify-center rounded-[10px] border text-[15px] font-semibold no-underline ${
    highlight ? "border-accent bg-accent text-background hover:bg-accent-strong" : "border-border bg-background text-foreground hover:border-border-strong"
  }`;
  if (!href) return <span className={`${className} cursor-default opacity-60`}>Memberships open soon</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {tier.cta}
    </a>
  );
}

/** The membership cards. `perks` lists each tier's perks (the landing
 * page); otherwise each shows its one-line pitch and a monthly/yearly
 * switch (the Support page, which has a full comparison table). */
export function Tiers({ tiers, variant }: { tiers: Tier[]; variant: "perks" | "billing" }) {
  const [yearly, setYearly] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      {variant === "billing" && (
        <div role="group" aria-label="Billing period" className="flex self-start rounded-xl border border-border bg-surface p-1">
          {[false, true].map((y) => (
            <button
              key={String(y)}
              type="button"
              aria-pressed={yearly === y}
              onClick={() => setYearly(y)}
              className={`min-h-10 rounded-lg px-4 text-[15px] font-semibold ${yearly === y ? "bg-accent text-background" : "text-soft hover:text-foreground"}`}
            >
              {y ? "Yearly · save 15%" : "Monthly"}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {tiers.map((t) => {
          const highlight = t.name === "Studio";
          const year = Math.round(t.price * 12 * 0.85);
          const price = t.price === 0 ? "Free" : `$${variant === "billing" && yearly ? year : t.price}`;
          const per = t.price === 0 ? "" : variant === "billing" && yearly ? "/year" : "/month";
          return (
            <article key={t.name} className={`flex flex-col gap-4 rounded-2xl border p-6 ${highlight ? "border-accent bg-glow" : "border-border bg-surface"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className={`text-[14px] font-semibold uppercase tracking-[1.6px] ${highlight ? "text-accent" : "text-soft"}`}>{t.name}</h3>
                {highlight && <span className="rounded-full bg-accent px-2 py-0.5 text-[10.5px] font-bold tracking-[1px] text-background">BEST VALUE</span>}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-[38px] font-semibold leading-none text-foreground">{price}</span>
                {per && <span className="text-[14px] text-muted">{per}</span>}
              </div>
              {variant === "billing" && t.price > 0 && yearly && <div className="-mt-2 text-[13px] text-muted">About ${(year / 12).toFixed(2)} a month</div>}
              {variant === "perks" ? (
                <ul className="flex flex-col gap-3 pb-2">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-[15px] leading-snug text-soft">
                      <CheckIcon size={16} />
                      {p}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pb-2 text-[15px] leading-normal text-soft">{t.blurb}</p>
              )}
              <TierButton tier={t} highlight={highlight} />
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** The installed app opens on the studio; apps installed before the site
 * existed still start at "/", so send them on. */
export function OpenStudioIfInstalled() {
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) location.replace(APP_PATH);
  }, []);
  return null;
}
