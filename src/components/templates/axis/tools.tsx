import { motion } from "motion/react";

type Tool = {
  name: string;
  lightImage: string;
};

export default function Tools() {
  const tools: Tool[] = [
    { name: "Notion", lightImage: "/logo/templates/axis/notion.svg" },
    { name: "Medium", lightImage: "/logo/templates/axis/medium.svg" },
    { name: "Mailchimp", lightImage: "/logo/templates/axis/mailchip.svg" },
    { name: "Calendly", lightImage: "/logo/templates/axis/calendly.svg" },
    { name: "Loom", lightImage: "/logo/templates/axis/loom.svg" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex w-full flex-col items-center justify-center lg:my-6"
    >
      <div className="mb-12 flex flex-col items-center gap-3 px-4 text-center">
        <h2 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Works with the tools you already use
        </h2>
        <p className="max-w-md text-sm text-muted-foreground sm:text-base">
          Send what matters from your own mailbox and keep the rest of your stack where it is.
        </p>
      </div>

      <div className="flex items-center justify-center -space-x-3">
        {tools.map((tool, index) => (
          <motion.div
            key={tool.name}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: index * 0.1, ease: "easeOut" }}
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-transparent"
          >
            <img
              src={tool.lightImage}
              alt={tool.name}
              width={56}
              height={56}
              className="h-full w-full object-contain dark:invert"
            />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
