import net from "node:net";

export type MalwareScanner = { scan(body: Buffer): Promise<"CLEAN" | "INFECTED"> };

export function clamScanner(host: string, port: number): MalwareScanner {
  return { scan: (body) => scanBuffer(host, port, body) };
}

export async function scanBuffer(host: string, port: number, body: Buffer): Promise<"CLEAN" | "INFECTED"> {
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, host);
    socket.setTimeout(5000, () => {
      socket.destroy(new Error("clamav timed out"));
    });
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.write("zINSTREAM\0");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    socket.write(length);
    socket.write(body);
    socket.write(Buffer.alloc(4));
    socket.end();
  });
  if (response.includes("FOUND")) return "INFECTED";
  if (response.includes("OK")) return "CLEAN";
  throw new Error("clamav returned an unrecognized result");
}
