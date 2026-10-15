export function IphoneFrame({
  size = "stage",
  children,
}: {
  size?: "stage" | "compact";
  children: React.ReactNode;
}) {
  return (
    <div className={`iphone${size === "compact" ? " is-compact" : ""}`}>
      <span className="iphone-btn iphone-action" aria-hidden="true" />
      <span className="iphone-btn iphone-vol" aria-hidden="true" />
      <span className="iphone-btn iphone-vol-2" aria-hidden="true" />
      <span className="iphone-btn iphone-power" aria-hidden="true" />
      <div className="iphone-glass">
        <span className="iphone-island" aria-hidden="true" />
        <div className="iphone-scroll">{children}</div>
        <span className="iphone-home" aria-hidden="true" />
      </div>
    </div>
  );
}
