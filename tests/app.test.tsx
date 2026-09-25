import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App";

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

  it("shows scores, rankings and ad assets on the my business page", async () => {
    await render();
    click(findByText("button", "My Business"));
    expect(text()).toContain("My business");
    expect(text()).toContain("SEO score");

    click(findByText("button", "SEO & GEO"));
    expect(text()).toContain("Top ranking SEO keywords this week");
    expect(text()).toContain("Top ranking GEO prompts this week");

    click(findByText("button", "Reviews"));
    expect(text()).toContain("Review page analysis");

    click(findByText("button", "Ad assets"));
    expect(text()).toContain("Download pack");

    click(findByText("button", "Buy list"));
    expect(text()).toContain("Inventory you should get next");
  });

  it("lists scan alerts on the dedicated notifications page", async () => {
    await render();
    click(findByText("button", "Notifications"));

    const content = text();
    expect(content).toContain("Everything your scans raised");
    expect(content).toContain("Needs action");
    expect(content).toContain("All notifications");
  });

  it("opens the business profile dialog with the logo uploader", async () => {
    await render();
    click(container.querySelector('button[aria-label="Business profile"]'));
    const dialog = activeDialog();
    expect(dialog.textContent ?? "").toContain("Business logo");
    expect(dialog.textContent ?? "").toContain("Upload logo");
  });
});
