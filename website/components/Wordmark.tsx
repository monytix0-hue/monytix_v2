export function Wordmark({ height = 34 }: { height?: number }) {
  return (
    <img
      className="wordmark"
      src="/monytix.png"
      alt="Monytix"
      style={{ height, width: "auto" }}
    />
  );
}
