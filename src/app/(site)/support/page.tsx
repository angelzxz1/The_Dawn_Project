import type { Metadata } from "next";
import Link from "next/link";
import { PERKS, TIERS } from "@/content/tiers";
import { PackCover } from "@/site/illustrations";
import { Tiers } from "@/site/interactive";
import { CheckIcon, Container, CtaBand, PageIntro, Screws, SectionHead, h2Class, leadClass, primaryButton, secondaryButton } from "@/site/ui";
import { supportLink } from "@/site/siteLinks";
import { contactEmail, membershipPlatforms } from "@/services/support";

export const metadata: Metadata = {
  title: "Support",
  description: "Dawn has no ads and no paywalls. Memberships, one-time tips and other ways to keep it free for everyone.",
};

const WHERE_IT_GOES: [string, string][] = [
  ["Development time", "So Dawn can keep getting a new headline feature every month."],
  ["Tones and sounds", "Amp captures, cabinet IRs, drum kits and grooves, made or licensed properly."],
  ["Running costs", "The domain, storage for large files and the tools that keep Dawn online."],
];

const PACKS: [string, string][] = [
  ["Classic Rock Tones", "Amp captures, cabinet IRs, guitar chains and rock grooves"],
  ["Modern Metal", "High-gain captures, tight cabinets, gate and EQ presets"],
  ["Trap and Drill Drums", "808 kit, hi-hat patterns, bass presets and sidechain setups"],
  ["Lo-fi Bedroom", "Dusty kit, lo-fi saturation and filter presets, chill grooves"],
  ["Latin Rhythms", "Reggaeton, cumbia and salsa-inspired grooves and percussion"],
  ["Vocal Chains", "Presets for rap, pop and ballad vocals"],
];

export default function SupportPage() {
  const kofi = supportLink("kofi");
  const discord = supportLink("discord");
  const email = contactEmail();
  // Tone creators send files and give permission to use them, so email
  // (which keeps a record) comes first.
  const tones = email ? `mailto:${email}?subject=${encodeURIComponent("Tones for Dawn")}` : discord;
  // Each card shows only once its page exists; the last always does.
  const ways: { label: string; title: string; text: string; href: string; external?: boolean }[] = [
    { label: "Ko-fi", title: "Leave a one-time tip", text: "Prefer not to subscribe? A single tip helps just as much.", href: kofi, external: true },
    { label: "Discord", title: "Share your demo", text: "Post it in #share-your-demos and join the monthly Demo Challenge.", href: discord, external: true },
    { label: "Discord", title: "Report a bug", text: "Every clear bug report makes Dawn better for everyone. Post it in #bug-reports.", href: discord, external: true },
    { label: "Creators", title: "Share your tones", text: "Make NAM captures or IRs? Let's feature them in Dawn, with credit.", href: tones, external: true },
    { label: "Anyone", title: "Tell a friend", text: 'Send Dawn to the bandmate who always says "record it later".', href: "/" },
  ].filter((w) => w.href);

  return (
    <>
      <PageIntro title="Keep Dawn free for everyone." lead="Dawn has no ads and no paywalls. It's made by one developer and kept going by the people who use it.">
        <div className="flex flex-wrap gap-3 pt-1">
          <a href="#tiers" className={primaryButton}>
            See memberships
          </a>
          {kofi && (
            <a href={kofi} target="_blank" rel="noreferrer" className={secondaryButton}>
              Leave a one-time tip
            </a>
          )}
        </div>
      </PageIntro>

      <section aria-labelledby="why-h" className="pt-[96px]">
        <Container>
          <div className="faceplate relative grid gap-10 rounded-lg border border-border-strong p-[clamp(28px,4vw,48px)] lg:grid-cols-[1.2fr_1fr]">
            <Screws />
            <div className="flex flex-col gap-3.5">
              <h2 id="why-h" className={`${h2Class} text-[clamp(28px,3vw,38px)]`}>
                One developer, no ads, no paywalls.
              </h2>
              <p className={leadClass}>
                Hi, I&rsquo;m Angel. I build The Dawn Project on my own because I think anyone with an idea should be able to record it. I want Dawn to stay
                free for everyone, and that only works if the people who find it useful help keep it going.
              </p>
              <p className={leadClass}>Every quarter I&rsquo;ll share how Dawn is doing: users, supporters and what the money paid for.</p>
            </div>
            <div className="flex flex-col gap-3 self-center">
              <h3 className="text-[15px] font-semibold text-foreground">Where the money goes</h3>
              <ul className="flex flex-col divide-y divide-black/40 rounded-md border border-black/60 bg-[#141316] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]">
                {WHERE_IT_GOES.map(([title, text]) => (
                  <li key={title} className="flex flex-col gap-1 px-5 py-4">
                    <span className="text-[16px] font-semibold text-foreground">{title}</span>
                    <span className="text-[15px] leading-normal text-soft">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Container>
      </section>

      <section id="tiers" aria-labelledby="tiers-h" className="scroll-mt-6 pt-[104px]">
        <Container className="flex flex-col gap-6">
          <SectionHead id="tiers-h" eyebrow="Memberships" title="Pick what feels right." />
          <Tiers tiers={TIERS} variant="billing" />
          <p className="text-[14px] text-muted">Memberships run on {membershipPlatforms().join(" and ")}. Cancel any time. Prices in USD; taxes may apply.</p>
          <div className="faceplate overflow-x-auto rounded-lg border border-border-strong">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <caption className="px-5 pt-5 text-left font-display text-[22px] font-bold text-foreground">Compare tiers</caption>
              <thead>
                <tr className="border-b border-black/50">
                  <th scope="col" className="px-5 py-3 text-[13px] font-semibold text-muted">
                    Perk
                  </th>
                  {TIERS.map((t) => (
                    <th key={t.name} scope="col" className={`px-3 py-3 text-center text-[13px] font-semibold ${t.name === "Studio" ? "text-accent" : "text-soft"}`}>
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERKS.map(([perk, from]) => (
                  <tr key={perk} className="border-b border-black/40 last:border-b-0">
                    <th scope="row" className="px-5 py-3 text-[15px] font-normal text-foreground">
                      {perk}
                    </th>
                    {TIERS.map((t, i) => (
                      <td key={t.name} className="px-3 py-3 text-center">
                        {i >= from ? (
                          <span className="inline-flex" aria-label="Included">
                            <CheckIcon size={16} />
                          </span>
                        ) : (
                          <span aria-label="Not included" className="text-muted">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section aria-labelledby="packs-h" className="pt-[104px]">
        <Container className="flex flex-col gap-7">
          <SectionHead
            id="packs-h"
            eyebrow="Monthly packs"
            title="A new sound pack every month."
            lead="Studio and Producer supporters get each pack on release day. Older packs are later sold individually or released to everyone."
          />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            {PACKS.map(([name, text], i) => (
              <li key={name} className="faceplate flex flex-col overflow-hidden rounded-lg border border-border-strong">
                <PackCover n={i + 1} />
                <div className="flex flex-col gap-1.5 px-5 py-4">
                  <h3 className="font-display text-[20px] font-bold text-foreground">{name}</h3>
                  <p className="text-[14px] leading-normal text-soft">{text}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[14px] text-muted">
            Packs install from File → Sound Packs in the studio. Planned themes; the order may change with supporters&rsquo; votes.
          </p>
        </Container>
      </section>

      <section aria-labelledby="ways-h" className="pt-[104px]">
        <Container className="flex flex-col gap-7">
          <SectionHead id="ways-h" eyebrow="Other ways to help" title="Not ready to subscribe? That's fine." />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {ways.map((w) => {
              const inner = (
                <>
                  <span className="text-[13px] text-muted">{w.label}</span>
                  <span className="text-[17px] font-semibold text-foreground underline decoration-accent/0 decoration-2 underline-offset-4 transition-colors group-hover:decoration-accent">{w.title}</span>
                  <span className="text-[15px] leading-normal text-soft">{w.text}</span>
                </>
              );
              const className = "faceplate group flex flex-col gap-2 rounded-lg border border-border-strong p-5 no-underline hover:border-accent";
              return w.external ? (
                <a key={w.title} href={w.href} {...(w.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer" })} className={className}>
                  {inner}
                </a>
              ) : (
                <Link key={w.title} href={w.href} className={className}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      <section aria-labelledby="sfaq-h" className="pt-[88px]">
        <Container>
          <div className="faceplate relative flex flex-wrap items-center justify-between gap-5 rounded-lg border border-border-strong p-[clamp(28px,4vw,48px)]">
            <Screws />
            <div className="flex max-w-[620px] flex-col gap-2">
              <h2 id="sfaq-h" className={`${h2Class} text-[clamp(26px,2.8vw,34px)]`}>
                Questions about supporting?
              </h2>
              <p className={leadClass}>Cancelling, one-time tips and what each tier includes are all in the FAQ.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link href="/faq" className={secondaryButton}>
                Read the FAQ
              </Link>
              {discord && (
                <a href={discord} target="_blank" rel="noreferrer" className={secondaryButton}>
                  Join the Discord
                </a>
              )}
            </div>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
