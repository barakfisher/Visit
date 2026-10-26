export const labels = { minimumNoticeMinutes: 'setup.minimumNotice', maximumAdvanceDays: 'setup.maximumAdvance', bufferBeforeMinutes: 'setup.bufferBefore', bufferAfterMinutes: 'setup.bufferAfter', cancellationCutoffMinutes: 'setup.cancelCutoff', rescheduleCutoffMinutes: 'setup.rescheduleCutoff' } as const;
export const contacts = ['requireCustomerName', 'requireVerifiedPhone', 'requireVerifiedEmail'] as const;
export type NumericKey = keyof typeof labels;
export type Policy = Record<NumericKey, number> & Partial<Record<typeof contacts[number], boolean>>;
