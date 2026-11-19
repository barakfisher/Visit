export type PasswordMode = 'sign-in' | 'sign-up';
/** Sign-up's second step, after the form: the six-digit code sent to the address (login-plan-stage-2.md, slice 1). */
export type SignUpCodeStep = {
  email: string; code: string; cooldown: number; remaining: number; needsNewCode: boolean; issued: boolean;
  setCode: (value: string) => void; verify: () => void; resend: () => void; changeEmail: () => void;
};
export type PasswordSignInView = {
  mode: PasswordMode; email: string; password: string; displayName: string; busy: boolean; error: string; canSubmit: boolean;
  setEmail: (value: string) => void; setPassword: (value: string) => void; setDisplayName: (value: string) => void; submit: () => void;
  codeStep: SignUpCodeStep | null;
};
