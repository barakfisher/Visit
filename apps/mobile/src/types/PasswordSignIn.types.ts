export type PasswordMode = 'sign-in' | 'sign-up';
export type PasswordSignInView = {
  mode: PasswordMode; email: string; password: string; displayName: string; busy: boolean; error: string; canSubmit: boolean;
  setEmail: (value: string) => void; setPassword: (value: string) => void; setDisplayName: (value: string) => void; submit: () => void;
};
