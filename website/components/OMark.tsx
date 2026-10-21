import { OMARK_VIEWBOX, omarkFill, omarkPaths } from "@/lib/omark";
import type { Segment } from "@/lib/site";

const order: Segment[] = ["yellow", "cyan", "orange", "navy"];

export function OMark({
  size = 140,
  active = null,
  className = "",
  title = "Monytix mark",
}: {
  size?: number;
  active?: Segment | null;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`omark${active ? " is-focus" : ""} ${className}`.trim()}
      width={size}
      height={size}
      viewBox={OMARK_VIEWBOX}
      role="img"
      aria-label={title}
    >
      {order.map((key) => (
        <path
          key={key}
          className={`seg-${key}${active === key ? " is-on" : ""}`}
          fill={omarkFill[key]}
          d={omarkPaths[key]}
        />
      ))}
    </svg>
  );
}
