import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#0D1218",
          display: "flex",
          flexWrap: "wrap",
        }}
      >
        <div style={{ width: 16, height: 16, background: "#F9C515" }} />
        <div style={{ width: 16, height: 16, background: "#55C2EF" }} />
        <div style={{ width: 16, height: 16, background: "#313A96" }} />
        <div style={{ width: 16, height: 16, background: "#F47521" }} />
      </div>
    ),
    size,
  );
}
