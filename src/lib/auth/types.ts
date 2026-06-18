/**
 * Principal: the app's in-memory view of who is logged in.
 *
 * Shape mirrors GET /api/auth/me. The session cookie (enviable.sid) stays
 * httpOnly and is never read by client JS; this struct is the only auth
 * artifact the client may touch. Do not stash it in localStorage or
 * sessionStorage; provider state is the canonical store for the session.
 *
 * The `permissions` field is the union of all role grants, with the IT Admin
 * "*" already expanded by the backend, so `has(key)` is a pure membership
 * check, no wildcard handling required.
 */
export type Principal = {
  id: string;
  fullName: string;
  email: string;
  roles: string[];
  permissions: string[];
  /**
   * True when the backend requires this user to set a new password before
   * accessing anything (newly created users start on the default password).
   * The SPA branches on this at boot/login to force the reset screen; the
   * backend independently 403s protected requests with PASSWORD_RESET_REQUIRED
   * (defence in depth). Optional in the type so principals cached before this
   * field existed deserialise cleanly (treated as not-required).
   */
  mustResetPassword?: boolean;
};

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export type AuthState =
  | { status: "loading"; principal: null }
  | { status: "authenticated"; principal: Principal }
  | { status: "anonymous"; principal: null };

export type LoginInput = { email: string; password: string };

export type LoginError =
  | { kind: "invalid_credentials" }
  | { kind: "network"; message: string }
  | { kind: "unexpected"; status: number };
