export class ExtractError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type PdfExtractor = {
  extractPdf(bytes: Buffer, password?: string | null): Promise<string>;
};
