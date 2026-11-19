export type PasswordMode = 'sign-in' | 'sign-up';
export type PasswordSignInView = {
  mode: PasswordMode; email: string; password: string; displayName: string; busy: boolean; error: string; canSubmit: boolean;
  setEmail: (value: string) => void; setPassword: (value: string) => void; setDisplayName: (value: string) => void; submit: () => void;
};
// The code step of sign-up (login-plan-stage-2.md, slice 1). `ended` means the pending sign-up can no longer
// be verified (expired, too many attempts, or the address was taken): only starting over helps.
export type SignUpCodeView = {
  email: string; code: string; busy: boolean; error: string; ended: boolean; accountExists: boolean; cooldown: number; issued: boolean;
  localNotice: string; setCode: (value: string) => void; verify: () => void; resend: () => void; changeAddress: () => void; loadLocalCode: () => void;
};
