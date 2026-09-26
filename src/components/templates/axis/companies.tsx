import {
  Binoculars,
  Bot,
  Globe2,
  MessageSquareQuote,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";

const sources: { name: string; detail: string; icon: LucideIcon }[] = [
  { name: "Supplier catalogues", detail: "Buy prices, SKUs, stock", icon: Truck },
  { name: "Competitor sites", detail: "Promos and range moves", icon: Binoculars },
  { name: "Search rankings", detail: "Tracked terms weekly", icon: Globe2 },
  { name: "AI answers", detail: "Who the models quote", icon: Bot },
  { name: "Customer reviews", detail: "Sentiment and replies", icon: MessageSquareQuote },
  { name: "Your own traffic", detail: "Visits, sources, trend", icon: TrendingUp },
];

export default function Companies() {
  return (
    <section className="flex w-full flex-col gap-8">
      <div className="flex flex-col items-center text-center">
        <h2 className="text-3xl font-medium tracking-tight text-foreground md:text-4xl">
          Watching for you
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          Every signal that decides whether a product sells — collected on the cadence you set.
        </p>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="grid grid-cols-1 border-t border-l border-border sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source) => (
            <div
              key={source.name}
              className="flex h-24 items-center gap-4 border-r border-b border-border px-6 transition-colors hover:bg-muted/40 lg:h-28"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                <source.icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{source.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {source.detail}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
