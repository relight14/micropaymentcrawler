import { Badge } from "./ui/badge";

interface SourceBadgeProps {
  license: "RSL" | "Tollbit" | "Cloudflare";
}

export function SourceBadge({ license }: SourceBadgeProps) {
  const badgeVariants = {
    RSL: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    Tollbit: "bg-green-100 text-green-800 hover:bg-green-100", 
    Cloudflare: "bg-orange-100 text-orange-800 hover:bg-orange-100"
  };

  return (
    <Badge variant="secondary" className={badgeVariants[license]}>
      {license}
    </Badge>
  );
}