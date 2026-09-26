import { cn } from "@/lib/utils";

export default function BlurredOrb({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        "h-16 w-16 rounded-full bg-gradient-to-b from-primary to-secondary blur-3xl",
        className,
      )}
      style={style}
    />
  );
}
