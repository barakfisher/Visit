export type Method = { id: string; method: 'email' | 'phone' | 'google'; label: string | null; verified: boolean; canRemove: boolean };
export type Notification = { channel: 'email' | 'phone'; status: 'QUEUED' | 'SENDING' | 'ACCEPTED' | 'FAILED' | 'BLOCKED'; provider: string | null };
export type Methods = { identityId: string; methods: Method[]; events: { id: string; action: 'LINKED' | 'REPLACED' | 'REMOVED'; method: Method['method']; createdAt: string; notifications: Notification[] }[]; capabilities: { email: boolean; phone: boolean }; reauthRequired: boolean };
export type Issued = { identity: { id: string }; sessionToken?: string };
