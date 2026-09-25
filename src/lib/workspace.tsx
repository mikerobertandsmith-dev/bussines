import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { authEnabled, dbEnabled } from "./env";
import { sampleProfile, sampleWorkspace } from "../data/sample";
import {
  addBuyListItem,
  createClientRow,
  createWorkspaceFromOnboarding,
  deleteBrandLogo,
  deleteClientRow,
  fetchBusiness,
  loadWorkspace,
  logSentMessages,
  markReviewScanComplete,
  queueScan,
  removeBuyListItem,
  saveMailAccountRow,
  setCompetitorCadence,
  setSupplierCadence,
  updateBrandLogo,
  updateClientRow,
  uploadBrandLogo,
} from "./repo";
import { setAccessTokenProvider } from "./supabase";
import { nextSendFrom } from "./schedule";
import type {
  BusinessProfile,
  Cadence,
  Client,
  MailAccount,
  MessageType,
  OnboardingInput,
  SendFrequency,
  WorkspaceData,
} from "./types";

export interface WorkspaceActions {
  setSupplierCadence: (supplierId: string, cadence: Cadence) => Promise<void>;
  scanSupplier: (supplierId: string) => Promise<void>;
  setCompetitorCadence: (competitorId: string, cadence: Cadence) => Promise<void>;
  scanCompetitor: (competitorId: string) => Promise<void>;
  addClient: (input: {
    name: string;
    email: string;
    company: string;
    industry: string;
    tier: Client["tier"];
    frequency: SendFrequency;
    messageTypes: MessageType[];
  }) => Promise<void>;
  updateClient: (clientId: string, patch: Partial<Client>) => Promise<void>;
  removeClient: (clientId: string) => Promise<void>;
  sendMessages: (clientIds: string[]) => Promise<number>;
  saveMailAccount: (account: MailAccount) => Promise<void>;
  toggleBuyList: (recommendationId: string, on: boolean) => Promise<void>;
  runReviewScan: () => Promise<void>;
  uploadLogo: (file: File) => Promise<void>;
  removeLogo: () => Promise<void>;
}

/** Reads a picked image as a data URL — used when no storage bucket is configured. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.readAsDataURL(file);
  });
}

export interface WorkspaceContextValue {
  data: WorkspaceData | null;
  profile: BusinessProfile | null;
  loading: boolean;
  error: string | null;
  needsOnboarding: boolean;
  mode: "demo" | "live";
  refresh: () => Promise<void>;
  completeOnboarding: (input: OnboardingInput) => Promise<void>;
  actions: WorkspaceActions;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return ctx;
}

/** Convenience for pages: these only render once a workspace is loaded. */
export function useWorkspaceData(): WorkspaceData {
  const { data } = useWorkspace();
  if (!data) throw new Error("Workspace data is not loaded yet");
  return data;
}

/* ------------------------------------------------------------ demo (no keys) */

function useSampleState() {
  const [data, setData] = useState<WorkspaceData>(() => sampleWorkspace());
  return [data, setData] as const;
}

function DemoWorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useSampleState();

  const patchData = useCallback(
    (updater: (current: WorkspaceData) => WorkspaceData) => {
      setData((current) => updater(current));
    },
    [setData],
  );

  const actions = useMemo<WorkspaceActions>(
    () => ({
      async setSupplierCadence(supplierId, cadence) {
        patchData((current) => ({
          ...current,
          suppliers: current.suppliers.map((s) => (s.id === supplierId ? { ...s, cadence } : s)),
        }));
      },
      async scanSupplier(supplierId) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          suppliers: current.suppliers.map((s) =>
            s.id === supplierId ? { ...s, lastScan: now } : s,
          ),
        }));
      },
      async setCompetitorCadence(competitorId, cadence) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) => (c.id === competitorId ? { ...c, cadence } : c)),
        }));
      },
      async scanCompetitor(competitorId) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === competitorId ? { ...c, lastScan: now } : c,
          ),
        }));
      },
      async addClient(input) {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          clients: [
            {
              id: `cl-${Date.now()}`,
              name: input.name,
              email: input.email,
              company: input.company,
              industry: input.industry,
              status: "active",
              tier: input.tier,
              joinedAt: now,
              lastContacted: now,
              nextSendAt: nextSendFrom(input.frequency, input.messageTypes),
              frequency: input.frequency,
              messageTypes: input.messageTypes,
              openRate: 0,
              monthlyFee: { starter: 180, growth: 320, premium: 480 }[input.tier],
            },
            ...current.clients,
          ],
        }));
      },
      async updateClient(clientId, patch) {
        patchData((current) => ({
          ...current,
          clients: current.clients.map((c) =>
            c.id === clientId
              ? {
                  ...c,
                  ...patch,
                  nextSendAt:
                    patch.frequency !== undefined
                      ? nextSendFrom(patch.frequency, patch.messageTypes ?? c.messageTypes)
                      : (patch.nextSendAt ?? c.nextSendAt),
                }
              : c,
          ),
        }));
      },
      async removeClient(clientId) {
        patchData((current) => ({
          ...current,
          clients: current.clients.filter((c) => c.id !== clientId),
        }));
      },
      async sendMessages(clientIds) {
        const now = new Date().toISOString();
        let count = 0;
        patchData((current) => {
          const messages = clientIds
            .map((id) => current.clients.find((c) => c.id === id))
            .filter((c): c is Client => Boolean(c));
          count = messages.length;
          return {
            ...current,
            sentMessages: [
              ...messages.map((c, i) => ({
                id: `sm-${Date.now()}-${i}`,
                clientId: c.id,
                clientName: c.name,
                subject: `Update for ${c.company}`,
                types: c.messageTypes,
                sentAt: now,
                status: "delivered" as const,
              })),
              ...current.sentMessages,
            ],
            clients: current.clients.map((c) =>
              clientIds.includes(c.id)
                ? { ...c, lastContacted: now, nextSendAt: nextSendFrom(c.frequency, c.messageTypes) }
                : c,
            ),
          };
        });
        return count;
      },
      async saveMailAccount(account) {
        // One cadence for the whole list — saving the configuration aligns every
        // customer so the batch goes out together.
        patchData((current) => ({
          ...current,
          mailAccount: account,
          clients: current.clients.map((c) => ({
            ...c,
            frequency: account.sendFrequency,
            nextSendAt: nextSendFrom(account.sendFrequency, c.messageTypes),
          })),
        }));
      },
      async toggleBuyList(recommendationId, on) {
        patchData((current) => ({
          ...current,
          buyList: on
            ? [...current.buyList, recommendationId]
            : current.buyList.filter((id) => id !== recommendationId),
        }));
      },
      async runReviewScan() {
        patchData((current) => ({
          ...current,
          latestReviewScan: { ...current.latestReviewScan, scannedAt: new Date().toISOString() },
        }));
      },
      async uploadLogo(file) {
        const logoUrl = await fileToDataUrl(file);
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
      },
      async removeLogo() {
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl: "" } }));
      },
    }),
    [patchData],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      profile: data.profile,
      loading: false,
      error: null,
      needsOnboarding: false,
      mode: "demo",
      refresh: async () => {},
      completeOnboarding: async () => {},
      actions,
    }),
    [data, actions],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/* --------------------------------------------------------- live (Clerk + DB) */

function LiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const { userId, getToken, isLoaded } = useAuth();
  const { user } = useUser();

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every Supabase request carries a fresh Clerk session token.
  useEffect(() => {
    setAccessTokenProvider(() => getToken());
    return () => setAccessTokenProvider(null);
  }, [getToken]);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  const bootstrap = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      if (!dbEnabled) {
        // Auth without a database: sign in works, data stays sample.
        setProfile(sampleProfile);
        setData(sampleWorkspace(sampleProfile));
        return;
      }
      const business = await fetchBusiness(userId);
      setProfile(business);
      if (business?.onboardingComplete) {
        setData(await loadWorkspace(business));
      } else {
        setData(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your workspace.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    void bootstrap();
  }, [isLoaded, userId, bootstrap]);

  const completeOnboarding = useCallback(
    async (input: OnboardingInput) => {
      if (!userId) throw new Error("You need to be signed in.");
      const created = await createWorkspaceFromOnboarding(userId, email, input);
      setProfile(created);
      setData(await loadWorkspace(created));
    },
    [userId, email],
  );

  const withBusiness = useCallback(
    async (run: (profile: BusinessProfile) => Promise<void>) => {
      if (!profile) return;
      try {
        await run(profile);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Something went wrong.");
        await bootstrap();
      }
    },
    [profile, bootstrap],
  );

  const patchData = useCallback((updater: (current: WorkspaceData) => WorkspaceData) => {
    setData((current) => (current ? updater(current) : current));
  }, []);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      async setSupplierCadence(supplierId, cadence) {
        patchData((current) => ({
          ...current,
          suppliers: current.suppliers.map((s) => (s.id === supplierId ? { ...s, cadence } : s)),
        }));
        if (dbEnabled) await withBusiness(() => setSupplierCadence(supplierId, cadence));
      },
      async scanSupplier(supplierId) {
        const supplier = data?.suppliers.find((s) => s.id === supplierId);
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          suppliers: current.suppliers.map((s) => (s.id === supplierId ? { ...s, lastScan: now } : s)),
        }));
        if (dbEnabled) {
          await withBusiness(async (business) => {
            const run = await queueScan({
              businessId: business.id,
              sourceType: "supplier",
              sourceId: supplierId,
              sourceName: supplier?.name ?? "Supplier",
            });
            patchData((current) => ({ ...current, scanRuns: [run, ...current.scanRuns] }));
          });
        }
      },
      async setCompetitorCadence(competitorId, cadence) {
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) => (c.id === competitorId ? { ...c, cadence } : c)),
        }));
        if (dbEnabled) await withBusiness(() => setCompetitorCadence(competitorId, cadence));
      },
      async scanCompetitor(competitorId) {
        const competitor = data?.competitors.find((c) => c.id === competitorId);
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          competitors: current.competitors.map((c) =>
            c.id === competitorId ? { ...c, lastScan: now } : c,
          ),
        }));
        if (dbEnabled) {
          await withBusiness(async (business) => {
            const run = await queueScan({
              businessId: business.id,
              sourceType: "competitor",
              sourceId: competitorId,
              sourceName: competitor?.name ?? "Competitor",
            });
            patchData((current) => ({ ...current, scanRuns: [run, ...current.scanRuns] }));
          });
        }
      },
      async addClient(input) {
        if (!dbEnabled) return;
        await withBusiness(async (business) => {
          const created = await createClientRow(business.id, { ...input, monthlyFee: 0 });
          patchData((current) => ({ ...current, clients: [created, ...current.clients] }));
        });
      },
      async updateClient(clientId, patch) {
        patchData((current) => ({
          ...current,
          clients: current.clients.map((c) => (c.id === clientId ? { ...c, ...patch } : c)),
        }));
        if (dbEnabled) await withBusiness(() => updateClientRow(clientId, patch));
      },
      async removeClient(clientId) {
        patchData((current) => ({
          ...current,
          clients: current.clients.filter((c) => c.id !== clientId),
        }));
        if (dbEnabled) await withBusiness(() => deleteClientRow(clientId));
      },
      async sendMessages(clientIds) {
        const targets = (data?.clients ?? []).filter((c) => clientIds.includes(c.id));
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          sentMessages: [
            ...targets.map((c, i) => ({
              id: `sm-${Date.now()}-${i}`,
              clientId: c.id,
              clientName: c.name,
              subject: `Update for ${c.company || c.name}`,
              types: c.messageTypes,
              sentAt: now,
              status: "delivered" as const,
            })),
            ...current.sentMessages,
          ],
          clients: current.clients.map((c) =>
            clientIds.includes(c.id)
              ? { ...c, lastContacted: now, nextSendAt: nextSendFrom(c.frequency, c.messageTypes) }
              : c,
          ),
        }));
        if (dbEnabled) {
          await withBusiness(async (business) => {
            await logSentMessages(
              business.id,
              targets.map((c) => ({
                clientId: c.id,
                clientName: c.name,
                subject: `Update for ${c.company || c.name}`,
                types: c.messageTypes,
              })),
            );
            await Promise.all(
              targets.map((c) =>
                updateClientRow(c.id, {
                  lastContacted: now,
                  nextSendAt: nextSendFrom(c.frequency, c.messageTypes),
                }),
              ),
            );
          });
        }
        return targets.length;
      },
      async saveMailAccount(account) {
        // One cadence for the whole list — saving the configuration aligns every
        // customer so the batch goes out together.
        patchData((current) => ({
          ...current,
          mailAccount: account,
          clients: current.clients.map((c) => ({
            ...c,
            frequency: account.sendFrequency,
            nextSendAt: nextSendFrom(account.sendFrequency, c.messageTypes),
          })),
        }));
        if (dbEnabled) {
          await withBusiness(async (business) => {
            await saveMailAccountRow(business.id, account);
            await Promise.all(
              (data?.clients ?? []).map((c) =>
                updateClientRow(c.id, {
                  frequency: account.sendFrequency,
                  messageTypes: c.messageTypes,
                  nextSendAt: nextSendFrom(account.sendFrequency, c.messageTypes),
                }),
              ),
            );
          });
        }
      },
      async toggleBuyList(recommendationId, on) {
        patchData((current) => ({
          ...current,
          buyList: on
            ? [...current.buyList, recommendationId]
            : current.buyList.filter((id) => id !== recommendationId),
        }));
        if (dbEnabled) {
          await withBusiness((business) =>
            on
              ? addBuyListItem(business.id, recommendationId)
              : removeBuyListItem(business.id, recommendationId),
          );
        }
      },
      async runReviewScan() {
        const now = new Date().toISOString();
        patchData((current) => ({
          ...current,
          latestReviewScan: { ...current.latestReviewScan, scannedAt: now },
        }));
        if (dbEnabled) await withBusiness((business) => markReviewScanComplete(business.id));
      },
      async uploadLogo(file) {
        if (!dbEnabled) {
          const logoUrl = await fileToDataUrl(file);
          setProfile((current) => (current ? { ...current, logoUrl } : current));
          patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
          return;
        }
        if (!userId) throw new Error("You need to be signed in to upload a logo.");
        try {
          const logoUrl = await uploadBrandLogo(userId, file);
          await updateBrandLogo(userId, logoUrl);
          setProfile((current) => (current ? { ...current, logoUrl } : current));
          patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl } }));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not upload the logo.");
          throw cause;
        }
      },
      async removeLogo() {
        setProfile((current) => (current ? { ...current, logoUrl: "" } : current));
        patchData((current) => ({ ...current, profile: { ...current.profile, logoUrl: "" } }));
        if (dbEnabled && userId) await deleteBrandLogo(userId);
      },
    }),
    [data, patchData, withBusiness, userId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      profile,
      loading,
      error,
      // No profile at all means the user has never onboarded — the row is only
      // created by finishing the wizard, so send them there instead of the
      // error screen. A real load error still wins, otherwise connection
      // problems would be hidden behind the onboarding form.
      needsOnboarding: !error && profile?.onboardingComplete !== true,
      mode: "live",
      refresh: bootstrap,
      completeOnboarding,
      actions,
    }),
    [data, profile, loading, error, bootstrap, completeOnboarding, actions],
  );

  if (!isLoaded) {
    return <WorkspaceLoading label="Checking your session…" />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/* --------------------------------------------------------------- entry point */

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  if (!authEnabled) return <DemoWorkspaceProvider>{children}</DemoWorkspaceProvider>;
  return <LiveWorkspaceProvider>{children}</LiveWorkspaceProvider>;
}

export function WorkspaceLoading({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <span className="text-sm text-slate-600">{label}</span>
      </div>
    </div>
  );
}
