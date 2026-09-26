import { motion } from "motion/react";
import Counter from "./counter";

const stats = [
  { name: "Supplier changes captured each week", value: 12, suffix: "K+" },
  { name: "Hours saved per month", value: 20, suffix: " hrs" },
  { name: "Signals in one ranked feed", value: 6, suffix: " sources" },
];

export default function Stats() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="lg:my-6"
    >
      <div className="mb-16 flex flex-col items-center gap-3 px-4 text-center">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Monitoring is a job nobody has time for
        </h2>
        <p className="max-w-md text-sm text-muted-foreground sm:text-base">
          Checking suppliers, competitors and your own visibility by hand costs hours every week.
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-4">
        <div className="grid grid-cols-1 border-t border-l border-border md:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.name}
              className="flex flex-col items-center justify-center border-r border-b border-border px-6 py-12 text-center"
            >
              <div className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                <Counter value={stat.value} suffix={stat.suffix} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{stat.name}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
