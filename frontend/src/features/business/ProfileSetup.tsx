import { ArrowLeft, ArrowRight, Briefcase, Check, KeyRound, MapPin, Package, Plus, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { SECTOR_IDS, type Profile } from "@/api/contract";
import { SectorChip } from "@/components/SectorChip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  addKeyword,
  addToProfile,
  KEYWORD_MAX,
  MAX_KEYWORDS,
  removeFromProfile,
  removeKeyword,
  ROLE_INFO,
  toggleSector,
  useProfile,
  type EntityRole,
} from "@/state/profile";

import { RemovableChip, StoreNote } from "./business-parts";
import { stepFilled } from "./business-data";
import { useEntityName } from "./entity-names";
import { EntityPicker } from "./EntityPicker";

const SETUP_STEPS = [
  { id: "sectors", title: "Your sectors", icon: Briefcase },
  { id: "places", title: "Your places", icon: MapPin },
  { id: "inputs", title: "Inputs and keywords", icon: Package },
] as const;

export interface ProfileSetupProps {
  /** "first-run": the welcome flow with Skip; "edit": the same steps with Done. */
  mode: "first-run" | "edit";
  initialStep?: number;
  /** Finished or closed; the profile is already saved. */
  onDone: () => void;
}

/**
 * The two-minute setup: three short steps with chips and search, no forms.
 * Every tap saves at once, so leaving half-way keeps what was chosen.
 */
export function ProfileSetup({ mode, initialStep = 0, onDone }: ProfileSetupProps) {
  const profile = useProfile();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), SETUP_STEPS.length - 1));
  const headingId = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const last = step === SETUP_STEPS.length - 1;
  const update = (fn: (p: Profile) => Profile) => profile.set(fn);

  const go = (next: number) => {
    setStep(next);
    // Move focus to the new step's heading so keyboard and screen-reader users follow along.
    requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>("h2")?.focus());
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-2">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg">
          <Briefcase className="size-5" />
        </span>
        <h1 id={headingId} className="text-figure font-semibold tracking-tight">
          {mode === "first-run" ? "Set up My Business" : "Edit your business profile"}
        </h1>
        <p className="text-body text-fg-muted">
          {mode === "first-run"
            ? "Three quick steps so WorldGraph can show what affects you. Everything is optional and you can change it any time."
            : "Change what WorldGraph watches for you. Changes save as you go."}
        </p>
      </header>

      <nav aria-label="Setup steps">
        <ol className="grid grid-cols-3 gap-2">
          {SETUP_STEPS.map((s, i) => {
            const done = stepFilled(profile.value, i);
            return (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={cn(
                    "flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-left text-label transition-colors",
                    i === step
                      ? "border-fg/50 bg-surface-2 text-fg"
                      : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-label tabular-nums",
                      done ? "border-transparent bg-fg text-bg" : "border-line-strong",
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className="truncate font-medium">{s.title}</span>
                  <span className="sr-only">
                    {`, step ${i + 1} of ${SETUP_STEPS.length}${done ? ", has choices" : ""}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div ref={bodyRef} className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4 sm:p-5">
        {step === 0 && <SectorsStep profile={profile.value} update={update} />}
        {step === 1 && <PlacesStep profile={profile.value} update={update} />}
        {step === 2 && <InputsStep profile={profile.value} update={update} />}
      </div>

      <StoreNote kind={profile.kind} error={profile.saveError} showDetail />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onDone}>
          {mode === "first-run" ? "Skip setup" : "Close"}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => go(step - 1)}>
              <ArrowLeft aria-hidden />
              Back
            </Button>
          )}
          {last ? (
            <Button onClick={onDone}>
              {mode === "first-run" ? "See what affects you" : "Done"}
              <Check aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => go(step + 1)}>
              Next
              <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type Update = (fn: (p: Profile) => Profile) => void;

function StepHeading({ title, hint }: { title: string; hint: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 tabIndex={-1} className="text-body font-semibold text-fg outline-none">
        {title}
      </h2>
      <p className="text-body text-fg-muted">{hint}</p>
    </div>
  );
}

function SectorsStep({ profile, update }: { profile: Profile; update: Update }) {
  return (
    <>
      <StepHeading title="What is your business in?" hint="Pick the sectors you work in. One to three is usual." />
      <div role="group" aria-label="Sectors" className="flex flex-wrap gap-2">
        {SECTOR_IDS.map((sector) => (
          <SectorChip
            key={sector}
            sector={sector}
            selected={profile.sectors.includes(sector)}
            onClick={(s) => update((p) => toggleSector(p, s))}
          />
        ))}
      </div>
    </>
  );
}

function PlacesStep({ profile, update }: { profile: Profile; update: Update }) {
  return (
    <>
      <StepHeading
        title="Where do you work?"
        hint="Countries, states or cities. News there, and stories that spill over, will reach your feed."
      />
      <RoleField
        role="locations"
        profile={profile}
        update={update}
        description="Where your offices, plants or shops are."
        placeholder="e.g. Gujarat, Vietnam, Rotterdam"
        noun="place"
      />
      <RoleField
        role="suppliers"
        profile={profile}
        update={update}
        description="Places or companies you source from."
        placeholder="e.g. Indonesia, a supplier company"
        noun="match"
      />
      <RoleField
        role="markets"
        profile={profile}
        update={update}
        description="Where your customers are."
        placeholder="e.g. United States, Germany"
        noun="place"
      />
    </>
  );
}

function InputsStep({ profile, update }: { profile: Profile; update: Update }) {
  return (
    <>
      <StepHeading title="What do you depend on?" hint="The inputs, routes and rivals you keep an eye on, plus any words to watch for." />
      <RoleField
        role="inputs"
        profile={profile}
        update={update}
        description="Commodities, ports, shipping routes or policies."
        placeholder="e.g. crude oil, Suez Canal, cotton"
        noun="match"
      />
      <RoleField
        role="competitors"
        profile={profile}
        update={update}
        description="Companies whose news matters to you."
        placeholder="e.g. a competitor or a big customer"
        noun="company"
      />
      <KeywordField profile={profile} update={update} />
    </>
  );
}

function RoleField({
  role,
  profile,
  update,
  description,
  placeholder,
  noun,
}: {
  role: EntityRole;
  profile: Profile;
  update: Update;
  description: string;
  placeholder: string;
  noun: string;
}) {
  const info = ROLE_INFO[role];
  const labelId = useId();
  const chosen = profile[role];
  return (
    <section aria-labelledby={labelId} className="flex flex-col gap-2">
      <div>
        <h3 id={labelId} className="text-body font-medium text-fg">
          {info.label}
        </h3>
        <p className="text-label text-fg-muted">{description}</p>
      </div>
      <EntityPicker
        types={info.types}
        exclude={chosen}
        onPick={(e) => update((p) => addToProfile(p, role, e.id))}
        label={`Add to ${info.label.toLowerCase()}`}
        placeholder={placeholder}
        noun={noun}
      />
      {chosen.length > 0 && (
        <ul aria-label={`${info.label}: chosen`} className="flex flex-wrap gap-1.5">
          {chosen.map((id) => (
            <li key={id} className="max-w-full min-w-0">
              <ChosenEntity id={id} onRemove={() => update((p) => removeFromProfile(p, role, id))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChosenEntity({ id, onRemove }: { id: string; onRemove: () => void }) {
  const entity = useEntityName(id);
  return (
    <RemovableChip
      type={entity.type}
      name={entity.missing ? `${entity.name} (no longer available)` : entity.name}
      muted={entity.loading || entity.missing}
      onRemove={onRemove}
      removeLabel={`Remove ${entity.name}`}
    />
  );
}

function KeywordField({ profile, update }: { profile: Profile; update: Update }) {
  const [text, setText] = useState("");
  const inputId = useId();
  const hintId = useId();
  const full = profile.keywords.length >= MAX_KEYWORDS;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Several at once: "cold chain, cotton yarn".
    const parts = text.split(",");
    update((p) => parts.reduce((acc, part) => addKeyword(acc, part), p));
    setText("");
  };

  return (
    <section className="flex flex-col gap-2">
      <div>
        <label htmlFor={inputId} className="text-body font-medium text-fg">
          Keywords
        </label>
        <p id={hintId} className="text-label text-fg-muted">
          Words to look for in headlines, e.g. cold chain or cotton yarn. Up to {MAX_KEYWORDS}.
        </p>
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
          <input
            id={inputId}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={KEYWORD_MAX * 3}
            disabled={full}
            aria-describedby={hintId}
            autoComplete="off"
            placeholder={full ? "That's the most keywords" : "Add a keyword"}
            className="h-10 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-9 text-body text-fg placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <Button type="submit" variant="outline" disabled={full || !text.trim()}>
          <Plus aria-hidden />
          Add
        </Button>
      </form>
      {profile.keywords.length > 0 && (
        <ul aria-label="Keywords: chosen" className="flex flex-wrap gap-1.5">
          {profile.keywords.map((k) => (
            <li key={k}>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2/70 pr-0.5 pl-2.5 text-label font-medium text-fg">
                <KeyRound aria-hidden className="size-3.5 text-fg-muted" />
                {k}
                <button
                  type="button"
                  onClick={() => update((p) => removeKeyword(p, k))}
                  aria-label={`Remove keyword ${k}`}
                  className="relative flex size-7 cursor-pointer items-center justify-center rounded-full text-fg-muted transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-surface-2 hover:text-fg"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
