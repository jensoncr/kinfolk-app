import { BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function VerifiedBadge() {
  return (
    <Badge aria-label="Phone verified" className="gap-1 px-2.5 py-1" variant="verified">
      <BadgeCheck aria-hidden className="size-3 shrink-0" strokeWidth={2.25} />
      Verified
    </Badge>
  );
}
