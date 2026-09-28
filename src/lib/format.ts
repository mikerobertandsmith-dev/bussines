export function daysAgo(days: number, hours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours, 0, 0, 0);
  return d.toISOString();
}

export function daysAhead(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (Math.abs(mins) < 1) return "just now";
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function money(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 100 ? 2 : 0,
  });
}

export function compact(value: number): string {
  return value.toLocaleString(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export function pct(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function cadenceLabel(c: string): string {
  switch (c) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "every_2_days":
      return "Every 2 days";
    default:
      return c;
  }
}

/** Host of a website URL, e.g. "supply.lumierecosmetics.com". Empty when unusable. */
export function domainFromUrl(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0]
      .replace(/^www\./, "");
  }
}

/**
 * A website as it should be stored and requested, from however someone typed it.
 *
 * `supplier.com`, `https://supplier.com/` and `https://supplier.com/wholesale`
 * all become `https://supplier.com`. Normalising in one place is what keeps the
 * onboarding step, the add/edit forms and the scrape input in agreement — and it
 * is about the *request* being valid, not about display (`domainFromUrl` above
 * is the display side).
 *
 * Only the host is kept: a catalogue path points a site scan at one page rather
 * than the site, and a query or fragment can point it somewhere unintended.
 * Returns "" when there is nothing usable, so callers can reject it rather than
 * store a string no scan can open — the same reason a handle is normalized before
 * it becomes a billed target.
 */
export function normaliseWebsite(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    // A host is the one thing a URL cannot be useful without.
    return url.hostname ? `${url.protocol}//${url.host}` : "";
  } catch {
    return "";
  }
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
