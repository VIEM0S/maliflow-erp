import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, setLocale } from "@/lib/i18n";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const next = locale === "fr" ? "en" : "fr";
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLocale(next)}
      className="gap-1.5 text-xs uppercase tracking-wide"
      aria-label={`Switch to ${next}`}
    >
      <Languages className="h-3.5 w-3.5" />
      {compact ? locale.toUpperCase() : `${locale.toUpperCase()} / ${next.toUpperCase()}`}
    </Button>
  );
}