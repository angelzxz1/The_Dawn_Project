import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LANDING_FAQ_IDS } from "@/content/faq";
import { EFFECT_COUNT } from "@/effects/registry";
import { TIERS } from "@/content/tiers";
import { ChainChips, EqCurve, FileTree } from "@/site/illustrations";
import { FaqAccordion, OpenStudioIfInstalled, Tiers } from "@/site/interactive";
import { CabinetCorners, CheckIcon, Container, CtaBand, OpenDawn, PilotLamp, Screws, SectionHead, Sun, h2Class, leadClass, secondaryButton, textLink } from "@/site/ui";
import { DEMO_VIDEO_URL, supportLink } from "@/site/siteLinks";

export const metadata: Metadata = {
  title: { absolute: "The Dawn Project — Your studio, one tab away" },
  description:
    `Record guitar through real amp models, make beats, mix with ${EFFECT_COUNT} studio effects and export your song, in a browser tab. Free, with nothing to install and no account.`,
};

/** The spec plate: what's in the box. */
const SPECS: [string, string][] = [
  [String(EFFECT_COUNT), "studio effects, with sidechain and automation"],
  ["NAM + IRs", "real amp models and cabinets, in a browser tab"],
  ["0", "installs, plugins or accounts needed"],
];

const STEPS: [string, string][] = [
  ["Pick a template", "Guitar demo, Beat, Voice + guitar, Podcast, or an empty project. Every template makes sound within three clicks."],
  ["Record", "Count-in, metronome, loop and latency alignment, so your takes land on the beat."],
  ["Export and share", "MP3 for your band chat, WAV for quality, stems and MIDI for your main DAW."],
];

const NEEDS: [string, string][] = [
  ["Chrome or Edge on a desktop computer", "Other browsers work with some limits."],
  ["Wired headphones", "Bluetooth adds a lot of delay when you play live."],
  ["An audio interface or USB guitar cable", "To record guitar or a microphone."],
  ["A few minutes with the setup guide", "Delay depends on your hardware. The guide helps you set it up."],
];

function PlayIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

/** A jack on the signal chain: where the cable comes in. */
function Jack() {
  return (
    <span aria-hidden="true" className="relative z-10 flex size-11 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#d9d7de,#7b7983_55%,#4a4950)] shadow-[0_2px_6px_rgba(0,0,0,0.6)]">
      <span className="size-4 rounded-full bg-[#0c0b0d] shadow-[inset_0_2px_3px_rgba(0,0,0,0.9)]" />
    </span>
  );
}

/** One stop on the signal chain: what it is, and a picture of it. */
function ChainStop({ name, title, text, children }: { name: string; title: string; text: string; children: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[44px_1fr] gap-x-5 gap-y-6 md:grid-cols-[44px_minmax(0,1fr)_minmax(0,1.1fr)] md:gap-x-10">
      <Jack />
      <div className="flex max-w-[460px] flex-col gap-3 pt-1.5">
        <p className="text-[15px] font-semibold text-accent">{name}</p>
        <h3 className="font-display text-[clamp(26px,2.6vw,32px)] font-bold leading-[1.12] text-foreground">{title}</h3>
        <p className="text-[17px] leading-[1.6] text-soft">{text}</p>
      </div>
      <div className="relative col-start-2 flex min-h-[200px] items-center justify-center overflow-hidden rounded-lg border border-black/60 bg-[#141316] p-6 shadow-[inset_0_2px_10px_rgba(0,0,0,0.6)] md:col-start-3">
        {children}
      </div>
    </li>
  );
}

/** A step as a pedal: what it does on top, its footswitch below. */
function Pedal({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <li className="faceplate relative flex flex-col gap-3 rounded-xl border border-border-strong px-6 pb-6 pt-7">
      <div className="flex items-center gap-2.5">
        <span className={`size-2.5 rounded-full ${n === 1 ? "bg-[#ffd08a] shadow-[0_0_10px_2px_rgba(255,176,77,0.7)]" : "bg-[#3b2f20]"}`} aria-hidden="true" />
        <span className="font-display text-[15px] font-bold text-muted">Step {n}</span>
      </div>
      <h3 className="font-display text-[26px] font-bold leading-tight text-foreground">{title}</h3>
      <p className="flex-1 text-[16px] leading-[1.6] text-soft">{text}</p>
      <span aria-hidden="true" className="mt-3 size-14 self-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#eceaf0,#9c9aa3_45%,#4f4e55)] shadow-[0_0_0_5px_#18171b,0_0_0_6px_#3a3940,0_4px_8px_6px_rgba(0,0,0,0.45)]" />
    </li>
  );
}

export default function Home() {
  const others: [string, string][] = (
    [
      ["kofi", "Ko-fi"],
      ["discord", "Join the Discord"],
    ] as const
  )
    .map(([id, label]): [string, string] => [supportLink(id), label])
    .filter(([url]) => url);

  return (
    <>
      <OpenStudioIfInstalled />

      {/* The amp: its control panel says what Dawn is, its grille carries
          the sun as its badge and the studio in front of it. */}
      <section id="top" className="pt-[clamp(28px,5vw,64px)]">
        <Container>
          <div className="relative rounded-lg bg-[#121114] p-1.5 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] sm:p-2">
            <CabinetCorners />
            <div className="faceplate relative grid items-end gap-8 rounded-t px-[clamp(22px,4.5vw,60px)] pb-[clamp(28px,4vw,48px)] pt-[clamp(36px,5vw,64px)] lg:grid-cols-[minmax(0,1fr)_auto]">
              <Screws />
              <div className="flex flex-col gap-5">
                <p className="flex items-center gap-2.5 text-[15px] font-semibold text-accent">
                  <PilotLamp />
                  Free, and it runs in your browser
                </p>
                <h1 className="max-w-[820px] font-display text-[clamp(44px,7vw,96px)] font-bold leading-[0.95] tracking-[-0.025em] text-foreground text-balance">
                  Your studio, one tab away.
                </h1>
                <p className={`${leadClass} max-w-[600px] text-[clamp(17px,1.5vw,19px)]`}>
                  Record guitar through real amp models, make beats, mix with {EFFECT_COUNT} studio effects and export your song. Nothing to install, no plugins to buy, no account.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="flex flex-wrap gap-3 lg:justify-end">
                  <OpenDawn />
                  {DEMO_VIDEO_URL && (
                    <a href={DEMO_VIDEO_URL} target="_blank" rel="noreferrer" className={secondaryButton}>
                      <PlayIcon /> Watch the 60-second demo
                    </a>
                  )}
                </div>
                <p className="text-[14px] text-muted">Works best in Chrome or Edge on a desktop computer.</p>
              </div>
            </div>
            <div className="piping" />
            <div className="grille relative overflow-hidden rounded-b px-[clamp(10px,3vw,40px)] pt-[clamp(28px,4vw,48px)]">
              <div className="mx-auto w-[min(640px,80%)]">
                <Sun />
              </div>
              <div className="relative -mt-[clamp(40px,10vw,140px)] overflow-hidden rounded-t-md border border-b-0 border-black/70 shadow-[0_-10px_40px_rgba(0,0,0,0.55)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/site/studio.webp"
                  width={2400}
                  height={1350}
                  alt="The Dawn Project studio: drums and a guitar take in the arrangement, with a gate, saturator, cabinet and EQ in the guitar’s effects rack"
                  className="block h-auto w-full"
                />
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* The spec plate, as on the back of an amp. */}
      <section aria-label="In numbers" className="pt-12">
        <Container>
          <dl className="relative mx-auto grid max-w-[920px] gap-px overflow-hidden rounded-md bg-[#8f8b82] p-px shadow-[0_2px_0_rgba(0,0,0,0.5),0_10px_30px_-10px_rgba(0,0,0,0.7)] sm:grid-cols-3">
            {SPECS.map(([big, small]) => (
              <div key={big} className="flex flex-col-reverse justify-end gap-1 bg-[linear-gradient(180deg,#d9d5cc,#bdb8ad)] px-7 py-6 text-[#26221c] [text-shadow:0_1px_0_rgba(255,255,255,0.45)]">
                <dt className="text-[15px] leading-snug text-[#4a443a]">{small}</dt>
                <dd className="font-display text-[34px] font-bold leading-none">{big}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section id="features" className="pt-28">
        <Container className="flex flex-col gap-14">
          <div className="flex max-w-[680px] flex-col gap-4">
            <SectionHead
              title="Everything you need to finish the demo."
              lead="Follow the signal: from your guitar, through a real amp and a rack of effects, to files you keep."
            />
            <Link href="/features" className={`${textLink} self-start`}>
              See every feature
            </Link>
          </div>
          <ol className="relative flex flex-col gap-16">
            {/* The cable between the jacks. */}
            <span aria-hidden="true" className="absolute bottom-24 left-[18px] top-6 w-2 rounded-full bg-[linear-gradient(90deg,#141316,#55545c_40%,#2a292e_70%,#141316)] shadow-[2px_0_6px_rgba(0,0,0,0.5)]" />
            <ChainStop
              name="The amp"
              title="Plug in and play through a real amp."
              text="Neural amp models (NAM) and cabinet impulse responses run right in the tab. Start from Dawn's own amps and cabinets, or load your own .nam captures and IRs."
            >
              <ChainChips items={["Gate", "NAM Amp", "Cabinet IR", "EQ", "Reverb"]} hot={["NAM Amp", "Cabinet IR"]} />
            </ChainStop>
            <ChainStop
              name="The rack"
              title={`${EFFECT_COUNT} effects, no plugins to buy.`}
              text="A 24-band EQ with mid/side, compressors, multiband dynamics and a saturator. Sidechain the kick to the bass in two clicks, and automate any knob."
            >
              <div className="w-full max-w-[420px]">
                <EqCurve />
              </div>
            </ChainStop>
            <ChainStop name="The output" title="No account. No cloud. Yours." text="Projects save as folders on your computer, with your undo history. Take stems and MIDI to any other DAW whenever you like.">
              <FileTree
                lines={[
                  { text: "▾ Late Night Riff/", depth: 0 },
                  { text: "project.dawn.json", depth: 1 },
                  { text: "history.json", depth: 1 },
                  { text: "▾ Samples/", depth: 1 },
                  { text: "guitar-take-3.wav", depth: 2 },
                  { text: "vocals-take-1.wav", depth: 2 },
                ]}
              />
            </ChainStop>
          </ol>
        </Container>
      </section>

      <section id="how" className="pt-28">
        <Container className="flex flex-col gap-10">
          <SectionHead title="Idea to demo before the idea fades." lead="Three steps, like three pedals on the floor." />
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
            {STEPS.map(([title, text], i) => (
              <Pedal key={title} n={i + 1} title={title} text={text} />
            ))}
          </ol>
          <Link href="/how-it-works" className={`${textLink} self-start`}>
            Read the walkthrough and setup guides
          </Link>
          {DEMO_VIDEO_URL && (
            <a
              id="video"
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
              className="grille relative flex aspect-video max-h-[560px] w-full items-center justify-center overflow-hidden rounded-lg border border-black/60 no-underline"
            >
              <div className="relative flex flex-col items-center gap-3.5 p-5 text-center">
                <span className="flex size-[76px] items-center justify-center rounded-full bg-accent text-on-accent shadow-[0_0_30px_-4px_rgba(230,173,94,0.6)]">
                  <PlayIcon size={26} />
                </span>
                <span className="text-[16px] text-foreground">Watch the 60-second demo: a riff, a groove, a mix and an MP3, all in a browser tab</span>
              </div>
            </a>
          )}
        </Container>
      </section>

      <section aria-labelledby="req-h" className="pt-28">
        <Container>
          <div className="faceplate relative grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-8 rounded-lg border border-border-strong p-[clamp(28px,4vw,52px)]">
            <Screws />
            <div className="flex flex-col gap-3.5">
              <h2 id="req-h" className={`${h2Class} text-[clamp(28px,3vw,40px)]`}>
                What to bring to the session.
              </h2>
              <p className={leadClass}>Dawn runs on what you have. These make it run well.</p>
            </div>
            <ul className="flex flex-col gap-4">
              {NEEDS.map(([title, text]) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="pt-0.5">
                    <CheckIcon />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[16px] font-semibold text-foreground">{title}</span>
                    <span className="text-[15px] text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>

      <section id="faq" className="pt-28">
        <Container className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-10">
          <div className="flex flex-col gap-4">
            <SectionHead title="Questions, answered straight." lead="Something else? Ask in the Discord." />
            <Link href="/faq" className={`${textLink} self-start`}>
              Every question
            </Link>
          </div>
          <FaqAccordion ids={LANDING_FAQ_IDS} />
        </Container>
      </section>

      <section id="support" className="pt-28">
        <Container className="flex flex-col gap-8">
          <SectionHead
            title="Dawn stays free. Supporters keep it growing."
            lead="Hi, I'm Angel, and I build The Dawn Project on my own. Support pays for development time, new amp tones, drum grooves and sound packs. Core features are never behind a paywall."
            className="max-w-[720px]"
          />
          <Tiers tiers={TIERS} variant="perks" />
          <div className="flex flex-wrap items-center gap-2.5">
            {others.length > 0 && <span className="pr-1 text-[15px] text-muted">Also on</span>}
            {others.map(([url, label]) => (
              <a key={label} href={url} target="_blank" rel="noreferrer" className={`${secondaryButton} min-h-11 text-[15px]`}>
                {label}
              </a>
            ))}
            <Link href="/support" className={`${textLink} px-2 text-[15px]`}>
              More ways to help
            </Link>
          </div>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
