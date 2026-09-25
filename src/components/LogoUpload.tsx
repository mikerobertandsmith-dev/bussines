import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Logo, btnGhost, btnPrimary } from "./ui";

const MAX_MB = 2;

/**
 * Upload / replace / remove the business logo. Used by the onboarding wizard
 * and by the workspace settings dialog.
 */
export function LogoUpload({
  logoUrl,
  brandName,
  onPick,
  onRemove,
  hint,
  compact = false,
}: {
  logoUrl: string;
  brandName: string;
  onPick: (file: File) => Promise<void> | void;
  onRemove?: () => Promise<void> | void;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file — PNG, JPG or SVG.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Keep the logo under ${MAX_MB} MB.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onPick(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That upload did not go through.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={compact ? "flex items-center gap-3" : "flex flex-wrap items-start gap-4"}>
      <Logo
        src={logoUrl}
        name={brandName || "Your brand"}
        size={compact ? 44 : 64}
        className="bg-indigo-500 text-white"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <button
            type="button"
            className={logoUrl ? btnGhost : btnPrimary}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>

          {logoUrl && onRemove ? (
            <button
              type="button"
              className={btnGhost}
              disabled={busy}
              onClick={() => void onRemove()}
            >
              <Trash2 size={14} /> Remove
            </button>
          ) : null}
        </div>

        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
          <ImageIcon size={11} />
          {hint ?? `Square PNG or SVG works best, up to ${MAX_MB} MB. Shown in your top bar.`}
        </p>
        {error ? <p className="mt-1 text-[11px] text-rose-600">{error}</p> : null}
      </div>
    </div>
  );
}
