import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";

export type FaqItem = { q: string; a: string };

export default function Faq({ items }: { items: FaqItem[] }) {
  return (
    <motion.section
      id="faq"
      className="mx-auto max-w-3xl px-4"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="text-center">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Before you sign up.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
          The questions we get asked most about scanning, scoring and sending.
        </p>
      </div>

      <div className="mt-10 divide-y divide-border border-y border-border">
        {items.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground marker:hidden">
              {item.q}
              <ChevronDown
                size={16}
                className="shrink-0 text-muted-foreground transition group-open:rotate-180"
              />
            </summary>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </motion.section>
  );
}
