import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const completeOnboarding = vi.fn(async () => {});

/**
 * Stands in for the account's website read. Returns a payload of the same
 * shape the gateway and `sampleSocialSuggestions` return, including one platform
 * we can monitor and one we cannot.
 */
const previewCompetitorSocials = vi.fn(async () => ({
  status: "done",
  scannedUrl: "glowmart.com",
  costUsd: 0,
  unmonitored: ["YouTube"],
  suggestions: [
    {
      platform: "instagram",
      handle: "glowmart",
      url: "https://www.instagram.com/glowmart/",
      monitorable: true,
    },
    {
      platform: "tiktok",
      handle: "glowmarttv",
      url: "https://www.tiktok.com/@glowmarttv",
      monitorable: true,
    },
    {
      platform: "youtube",
      handle: "glowmart",
      url: "https://www.youtube.com/@glowmart",
      monitorable: false,
    },
  ],
}));

vi.mock("../src/lib/workspace", () => ({
  useWorkspace: () => ({
    data: null,
    profile: null,
    loading: false,
    error: null,
    needsOnboarding: true,
    mode: "live" as const,
    refresh: async () => {},
    completeOnboarding,
    actions: { previewCompetitorSocials },
  }),
  useWorkspaceData: () => {
    throw new Error("not loaded");
  },
}));

vi.mock("@clerk/clerk-react", () => ({
  useUser: () => ({ user: { primaryEmailAddress: { emailAddress: "owner@mystore.com" } } }),
}));

const { OnboardingPage } = await import("../src/pages/OnboardingPage");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  completeOnboarding.mockClear();
  previewCompetitorSocials.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string) {
  const el = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(label),
  );
  if (!el) throw new Error(`button not found: ${label}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Clicks the first button whose *whole* label matches, for the buttons that
 * share a word with another — "Add" also begins "Add their social profiles".
 */
function clickExact(label: string) {
  const el = Array.from(container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === label,
  );
  if (!el) throw new Error(`button not found: ${label}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Clicks an element directly, for icon-only buttons whose text says nothing. */
function clickElement(el: Element | null | undefined) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function selectPlatform(value: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Platform"]');
  if (!select) throw new Error("platform select not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function typeIntoPlaceholder(placeholder: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`input not found: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Types into an input named by its aria-label, for the ones with no placeholder. */
function typeIntoLabel(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`input not found: ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render() {
  await act(async () => {
    root.render(<OnboardingPage />);
  });
}

describe("Onboarding wizard", () => {
  it("blocks step one until the business name is filled in", async () => {
    await render();
    expect(container.textContent).toContain("Tell us about your business");

    const continueButton = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Continue"),
    ) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(container.textContent).toContain("Enter your business name to continue.");
  });

  it("walks every step and submits the collected profile", async () => {
    await render();

    // 1. Business
    typeIntoPlaceholder("e.g. Glow House Store", "Glow House Store");
    typeIntoPlaceholder("e.g. vegan cosmetics", "vegan cosmetics");
    click("Continue");
    expect(container.textContent).toContain("Your online presence");

    // 2. Presence
    typeIntoPlaceholder("yourstore.com", "glowhouse.com");
    click("Continue");
    expect(container.textContent).toContain("supplier sites should we watch");

    // 3. Suppliers
    typeIntoPlaceholder("e.g. Lumière Cosmetics Supply", "Lumière Supply");
    typeIntoPlaceholder("https://supplier.com/wholesale", "https://supply.lumiere.com");
    click("Continue");
    expect(container.textContent).toContain("competitors do you want to track");

    // 4. Competitors — leave blank, it is optional
    click("Continue");
    expect(container.textContent).toContain("messages they receive");

    // 5. Clients + messaging
    click("Add customer");
    typeIntoPlaceholder("e.g. Aisha Bello", "Aisha Bello");
    typeIntoPlaceholder("name@theirstore.com", "buyer@retailer.com");
    click("Continue");
    expect(container.textContent).toContain("What does winning look like");

    // 6. Finish
    click("Finish setup");
    await act(async () => {});

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    const payload = completeOnboarding.mock.calls[0][0] as any;
    expect(payload.brandName).toBe("Glow House Store");
    expect(payload.niche).toBe("vegan cosmetics");
    expect(payload.primaryDomain).toBe("glowhouse.com");
    expect(payload.suppliers).toHaveLength(1);
    expect(payload.suppliers[0].name).toBe("Lumière Supply");
    expect(payload.suppliers[0].website).toBe("https://supply.lumiere.com");
    expect(payload.competitors).toHaveLength(0);
    expect(payload.seedClients).toHaveLength(1);
    expect(payload.seedClients[0].email).toBe("buyer@retailer.com");
    expect(payload.loginEmail).toBe("owner@mystore.com");
  });

  it("records a competitor's social profiles by hand, one handle per platform", async () => {
    await render();

    typeIntoPlaceholder("e.g. Glow House Store", "Glow House Store");
    typeIntoPlaceholder("e.g. vegan cosmetics", "vegan cosmetics");
    click("Continue");
    typeIntoPlaceholder("yourstore.com", "glowhouse.com");
    click("Continue");
    typeIntoPlaceholder("e.g. Lumière Cosmetics Supply", "Lumière Supply");
    typeIntoPlaceholder("https://supplier.com/wholesale", "https://supply.lumiere.com");
    click("Continue");

    // Competitors. The social section is collapsed until it is asked for, so the
    // step opens as a list of names and websites.
    typeIntoPlaceholder("e.g. GlowMart Beauty", "GlowMart Beauty");
    typeIntoPlaceholder("https://competitor.com", "glowmart.com");
    expect(container.textContent).not.toContain("Handle or profile URL");

    click("Add their social profiles");
    expect(container.textContent).toContain("Handle or profile URL");

    // A pasted profile URL is reduced to the bare handle the scraper addresses.
    typeIntoPlaceholder("@glowmartbeauty", "https://www.instagram.com/glowmartbeauty/");
    clickExact("Add");
    expect(container.textContent).toContain("1 recorded");

    // A second platform is a second row, not a replacement.
    selectPlatform("tiktok");
    typeIntoPlaceholder("@glowmartbeauty", "@glowmartbeautytv");
    clickExact("Add");
    expect(container.textContent).toContain("2 recorded");

    // Re-adding Instagram replaces its handle instead of stacking a second target
    // for the same platform — one handle per platform is the model.
    selectPlatform("instagram");
    typeIntoPlaceholder("@glowmartbeauty", "glowmartbeauty2");
    clickExact("Add");
    expect(container.textContent).toContain("2 recorded");

    // Removing one takes that platform off and leaves the rest.
    clickElement(container.querySelector('button[aria-label="Remove TikTok profile"]'));
    expect(container.textContent).toContain("1 recorded");

    click("Continue");
    click("Continue");
    expect(container.textContent).toContain("Social profiles recorded");
    click("Finish setup");
    await act(async () => {});

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    const payload = completeOnboarding.mock.calls[0][0] as any;
    expect(payload.competitors).toHaveLength(1);
    expect(payload.competitors[0].name).toBe("GlowMart Beauty");
    // Normalised to a URL, exactly as the add/edit form would store it.
    expect(payload.competitors[0].website).toBe("https://glowmart.com");
    expect(payload.competitors[0].socials).toEqual([
      { platform: "instagram", handle: "glowmartbeauty2" },
    ]);
  });

  it("finds a competitor's socials from their own website, keeping the ones accepted", async () => {
    await render();

    typeIntoPlaceholder("e.g. Glow House Store", "Glow House Store");
    typeIntoPlaceholder("e.g. vegan cosmetics", "vegan cosmetics");
    click("Continue");
    typeIntoPlaceholder("yourstore.com", "glowhouse.com");
    click("Continue");
    typeIntoPlaceholder("e.g. Lumière Cosmetics Supply", "Lumière Supply");
    typeIntoPlaceholder("https://supplier.com/wholesale", "https://supply.lumiere.com");
    click("Continue");

    // Competitors. The read is collapsed behind its own toggle, so the step still
    // opens as names and websites — the automatic path is the second way in, not
    // a replacement for typing.
    typeIntoPlaceholder("e.g. GlowMart Beauty", "GlowMart Beauty");
    typeIntoPlaceholder("https://competitor.com", "glowmart.com");
    expect(container.textContent).not.toContain("Read their website");

    click("Find them automatically");
    click("Read their website");
    await act(async () => {});

    // The website that would actually be stored is the one that gets read.
    expect(previewCompetitorSocials).toHaveBeenCalledWith({
      url: "https://glowmart.com",
      label: "GlowMart Beauty",
    });
    // Two we can monitor are offered; the third is reported, never written.
    expect(container.textContent).toContain("Add 2 profiles");
    expect(container.textContent).toContain("Found, not monitored: YouTube");

    // A corrected handle becomes the user's own (`manual`); an untouched one stays
    // `discovered`, so the badge in Social presence never claims the user chose
    // something a scraper picked.
    typeIntoLabel("Instagram handle", "glowmartbeauty");
    click("Add 2 profiles");
    expect(container.textContent).toContain("2 recorded");

    click("Continue");
    click("Continue");
    expect(container.textContent).toContain("Social profiles recorded");
    click("Finish setup");
    await act(async () => {});

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    const payload = completeOnboarding.mock.calls[0][0] as any;
    expect(payload.competitors[0].socials).toEqual([
      { platform: "instagram", handle: "glowmartbeauty", source: "manual" },
      { platform: "tiktok", handle: "glowmarttv", source: "discovered" },
    ]);
  });

  it("still completes setup for a competitor with no social profiles", async () => {
    await render();

    typeIntoPlaceholder("e.g. Glow House Store", "Glow House Store");
    typeIntoPlaceholder("e.g. vegan cosmetics", "vegan cosmetics");
    click("Continue");
    typeIntoPlaceholder("yourstore.com", "glowhouse.com");
    click("Continue");
    typeIntoPlaceholder("e.g. Lumière Cosmetics Supply", "Lumière Supply");
    typeIntoPlaceholder("https://supplier.com/wholesale", "https://supply.lumiere.com");
    click("Continue");

    // The section is never opened, which is a legitimate answer: monitoring a
    // website's own signals does not need their socials.
    typeIntoPlaceholder("e.g. GlowMart Beauty", "Chroma Beauty");
    typeIntoPlaceholder("https://competitor.com", "chromabeauty.com");
    click("Continue");
    click("Continue");
    expect(container.textContent).toContain("Social profiles recorded");
    click("Finish setup");
    await act(async () => {});

    const payload = completeOnboarding.mock.calls[0][0] as any;
    expect(payload.competitors).toHaveLength(1);
    expect(payload.competitors[0].name).toBe("Chroma Beauty");
    // No key at all, so `createWorkspaceFromOnboarding` writes no rows rather
    // than writing an empty one.
    expect(payload.competitors[0].socials).toBeUndefined();
  });
});
