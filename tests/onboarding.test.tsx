import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const completeOnboarding = vi.fn(async () => {});

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
    actions: {},
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

function typeIntoPlaceholder(placeholder: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`input not found: ${placeholder}`);
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
});
