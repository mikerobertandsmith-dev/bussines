import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { inputClass } from "./primitives";
import { domainFromUrl } from "../lib/format";
import { platformLabel } from "../lib/social";
import type { CompetitorSocialInput, ContactDiscoveryResult } from "../lib/types";

/**
 * The one review checklist for website discovery.
 *
 * Both surfaces use it — onboarding ("Find them automatically") and Competition →
 * Social presence ("Find socials from their site") — so there is exactly one place
 * that decides what a proposal becomes. Nothing is applied by the checklist: it
 * only collects the user's decision, and the caller writes it.
 */

/** One profile in the list: whether it will be saved, and the handle to save. */
export interface SuggestionChoice {
  accepted: boolean;
  handle: string;
  edited: boolean;
}

export type SuggestionChoices = Record<string, SuggestionChoice>;

/**
 * The starting review: every monitorable profile ticked.
 *
 * Ticked rather than blank because the common case is accepting them, and because
 * a suggestion the user never looks at should not silently vanish. Unticking is
 * one click; retyping a handle to recover a lost one is not. Only the first
 * proposal per platform is offered, since one handle per platform is what the
 * unique index enforces.
 */
export function initialChoices(result: ContactDiscoveryResult | null): SuggestionChoices {
  const choices: SuggestionChoices = {};
  for (const suggestion of result?.suggestions ?? []) {
    if (!suggestion.monitorable || choices[suggestion.platform]) continue;
    choices[suggestion.platform] = { accepted: true, handle: suggestion.handle, edited: false };
  }
  return choices;
}

/**
 * Review state for one discovery result, replaced whenever a new one arrives.
 *
 * `accepted` is the payload: the handles to save, each carrying its own
 * provenance. A handle the user changed is theirs (`manual`); one left exactly as
 * the actor proposed it stays `discovered`, so the badge in Social presence never
 * claims the user chose something a scraper found.
 */
export function useSuggestionChoices(result: ContactDiscoveryResult | null) {
  const [choices, setChoices] = useState<SuggestionChoices>(() => initialChoices(result));

  useEffect(() => {
    setChoices(initialChoices(result));
  }, [result]);

  const toggle = useCallback((platform: string) => {
    setChoices((current) => {
      const row = current[platform];
      if (!row) return current;
      return { ...current, [platform]: { ...row, accepted: !row.accepted } };
    });
  }, []);

  const edit = useCallback(
    (platform: string, handle: string) => {
      const proposed = result?.suggestions.find((s) => s.platform === platform)?.handle ?? "";
      setChoices((current) => {
        const row = current[platform];
        if (!row) return current;
        return { ...current, [platform]: { ...row, handle, edited: handle !== proposed } };
      });
    },
    [result],
  );

  const accepted = useMemo<CompetitorSocialInput[]>(
    () =>
      Object.entries(choices)
        .filter(([, row]) => row.accepted)
        .map(([platform, row]) => ({
          platform,
          handle: row.handle,
          source: row.edited ? ("manual" as const) : ("discovered" as const),
        })),
    [choices],
  );

  return { choices, toggle, edit, accepted };
}

export function SocialSuggestions({
  result,
  choices,
  onToggle,
  onEdit,
}: {
  result: ContactDiscoveryResult;
  choices: SuggestionChoices;
  onToggle: (platform: string) => void;
  onEdit: (platform: string, handle: string) => void;
}) {
  const monitorable = result.suggestions.filter((suggestion) => suggestion.monitorable);
  const unmonitored = result.unmonitored.length
    ? result.unmonitored
    : result.suggestions
        .filter((suggestion) => !suggestion.monitorable)
        .map((suggestion) => platformLabel(suggestion.platform));

  const site = domainFromUrl(result.scannedUrl) || result.scannedUrl;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-500">
        {/* A read taken moments ago is replayed rather than repeated, so the
            surface says which of the two this is instead of implying a fresh
            scrape behind the same numbers. */}
        {result.cached ? `Reusing the read of ${site} from a moment ago. ` : `Read from ${site}. `}
        Nothing is saved until you accept it — a site's footer can name its web agency rather than
        the brand itself.
      </p>

      {monitorable.length ? (
        <ul className="space-y-1.5">
          {monitorable.map((suggestion) => {
            const row = choices[suggestion.platform] ?? {
              accepted: false,
              handle: suggestion.handle,
              edited: false,
            };
            const label = platformLabel(suggestion.platform);
            return (
              <li
                key={suggestion.platform}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={row.accepted}
                  aria-label={`Save ${label} profile`}
                  onClick={() => onToggle(suggestion.platform)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                    row.accepted
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-transparent hover:border-slate-400"
                  }`}
                >
                  <Check size={11} />
                </button>
                <span className="w-20 shrink-0 text-xs font-medium text-slate-700">{label}</span>
                <input
                  className={`${inputClass} max-w-52 py-1 text-xs`}
                  aria-label={`${label} handle`}
                  value={row.handle}
                  onChange={(event) => onEdit(suggestion.platform, event.target.value)}
                />
                <a
                  href={suggestion.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800"
                >
                  Check it <ExternalLink size={11} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Nothing we can monitor was found on their site. Add their handles by hand instead.
        </p>
      )}

      {unmonitored.length ? (
        <p className="text-[11px] text-slate-500">
          Found, not monitored: {unmonitored.join(", ")} — we have no scraper for those, so they are
          never saved.
        </p>
      ) : null}
    </div>
  );
}
