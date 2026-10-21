export class ExtractionFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ExtractionFailure";
    this.code = code;
  }
}
