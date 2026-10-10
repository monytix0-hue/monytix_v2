export class AuthError extends Error {
  constructor(
    readonly statusCode: 401 | 403 | 503,
    readonly code: "auth_unconfigured" | "unauthorized" | "revoked" | "owner_forbidden",
  ) {
    super(code);
  }
}
