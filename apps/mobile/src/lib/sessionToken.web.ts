// Browser authentication uses an HttpOnly cookie. Native credentials never enter
// ordinary browser persistence, and native storage code is excluded from web bundles.
let token: string | null = null;
export async function readSessionToken() { return token; }
export async function saveSessionToken(value: string | null) { token = value; }
