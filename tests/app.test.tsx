import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";
import { LandingPage } from "../src/pages/LandingPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  window.localStorage.clear();
  window.location.hash = "#/suppliers";
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function text() {
  return container.textContent ?? "";
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeInto(input: HTMLInputElement | null | undefined, value: string) {
  if (!input) throw new Error("input not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function findByText(selector: string, label: string) {
  return Array.from(container.querySelectorAll(selector)).find((el) =>
    (el.textContent ?? "").includes(label),
  );
}

function activeDialog() {
  const dialog = container.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("no dialog is open");
  return dialog;
}

function dialogButton(label: string) {
  return Array.from(activeDialog().querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(label),
  );
}

async function render() {
  await act(async () => {
    root.render(<App />);
  });
  return text();
}

describe("Market Watch app", () => {
  it("shows the supplier page with inventory changes and cadence controls", async () => {
    const content = await render();
    expect(content).toContain("Supplier updates");
    expect(content).toContain("Latest inventory from your suppliers");
    expect(content).toContain("Velvet Matte Lip Kit");

    // Monitored suppliers live in their own Watching section, above the table.
    expect(text()).toContain("Watching");
    expect(text()).toContain("Scan now");
    expect(text()).toContain("Daily");
  });

  it("navigates to the competition page and shows ad, keyword and review signals", async () => {
    await render();
    click(findByText("button", "Competition"));
    expect(text()).toContain("Competition watch");
    expect(text()).toContain("GlowMart Beauty");
    expect(text()).toContain("traffic and where it comes from");

    click(findByText("button", "Keywords"));
    expect(text()).toContain("Keyword & SEO gap vs your platform");

    click(findByText("button", "Ads"));
    expect(text()).toContain("Banner link");

    click(findByText("button", "Reviews"));
    expect(text()).toContain("Reviews their customers are leaving");
  });

  it("adds a customer on the clients page from the add-customer dialog", async () => {
    await render();
    click(findByText("button", "Clients"));
    expect(text()).toContain("Customer list");

    click(findByText("button", "Add customer"));
    const dialog = activeDialog();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Amina Yusuf"]'),
      "Test Retailer",
    );
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="name@theirstore.com"]'),
      "owner@testretailer.com",
    );

    click(dialogButton("Add customer"));
    await act(async () => {});

    const content = text();
    expect(content).toContain("Test Retailer");
    expect(content).toContain("owner@testretailer.com");
    expect(content).toContain("added to the active customer list");
  });

  it("keeps the dashboard reachable in demo mode without auth keys", async () => {
    await render();
    expect(text()).toContain("Demo data");
    expect(text()).toContain("Market Watch");
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("shows scores and rankings on the my business page", async () => {
    await render();
    click(findByText("button", "My Business"));
    expect(text()).toContain("My business");
    expect(text()).toContain("SEO score");
    expect(text()).not.toContain("Download pack");

    click(findByText("button", "SEO & GEO"));
    expect(text()).toContain("Top ranking SEO keywords this week");
    expect(text()).toContain("Top ranking GEO prompts this week");

    click(findByText("button", "Buy list"));
    expect(text()).toContain("Inventory you should get next");
  });

  it("renders the public landing page with its call to action", async () => {
    await act(async () => {
      root.render(<LandingPage />);
    });

    const content = text();
    expect(content).toContain("Market Watch");
    expect(content).toContain("Start free");
    expect(content).toContain("Watching for you");
    expect(content).toContain("Before you sign up.");

    // Screen gallery renders the workspace layouts with sample data.
    expect(content).toContain("Every screen, before you sign up.");
    expect(content).toContain("Suppliers monitored");
    expect(content).toContain("Competition");
  });

  it("keeps competitor alerts out of the customer messaging configuration", async () => {
    await render();
    click(findByText("button", "Clients"));
    click(findByText("button", "Configuration"));

    const dialog = activeDialog();
    const content = dialog.textContent ?? "";
    expect(content).toContain("What customers receive");
    expect(content).toContain("Send cadence");
    expect(content).not.toContain("Competitor alert");
  });

  it("lists scan alerts on the dedicated notifications page", async () => {
    await render();
    click(container.querySelector('button[aria-label="Notifications"]'));

    const content = text();
    expect(content).toContain("Everything your scans raised");
    expect(content).toContain("Needs action");
    expect(content).toContain("All notifications");
  });

  it("shows reviews and social on the dedicated social page", async () => {
    await render();
    click(findByText("button", "Social & reviews"));
    expect(text()).toContain("Review page analysis");
    expect(text()).toContain("Latest review scan");

    click(findByText("button", "Competitor reviews"));
    expect(text()).toContain("Competitor review brief");

    click(findByText("button", "Social media"));
    expect(text()).toContain("Social media score & where to focus");
  });

  it("lists the catalogue on the inventory page", async () => {
    await render();
    click(findByText("button", "Inventory & services"));
    expect(text()).toContain("Products & services");
    expect(text()).toContain("Velvet Matte Lip Kit");
  });

  it("builds an ad brief on the promotions page and keeps a history", async () => {
    await render();
    click(findByText("button", "Promotions"));
    const content = text();
    expect(content).toContain("Ad components");
    expect(content).toContain("Ad frame");
    expect(content).toContain("Ads history");
    expect(content).toContain("Discount type");
    expect(content).toContain("Update brief");
    expect(content).toContain("Lip kit — weekend sale");
    expect(content).toContain("In design");
  });

  it("opens the business profile dialog with the logo uploader", async () => {
    await render();
    click(container.querySelector('button[aria-label="Business profile"]'));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Business logo");
    expect(dialog.textContent ?? "").toContain("Upload logo");
  });

});
