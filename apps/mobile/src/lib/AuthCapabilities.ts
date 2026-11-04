// A method appears only when the server can deliver it. A disabled "not configured yet" option is a dead end for real users,
// so while capabilities load or fail, nothing that depends on them is offered.
export type AuthCapabilities = { sms: boolean; google: boolean; googleNative: boolean; email: boolean };
export const CONTACT_CHANNELS = ['email', 'phone'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export function offersGoogle(capabilities: Partial<AuthCapabilities> | undefined, platform: string) {
  return (platform === 'web' ? capabilities?.google : capabilities?.googleNative) === true;
}
export function contactChannels(capabilities: Partial<Record<ContactChannel, boolean>> | undefined): ContactChannel[] {
  return CONTACT_CHANNELS.filter(channel => capabilities?.[channel] === true);
}
/** The channel the form works on: the one picked, or the first offered once the picked one is not. */
export function activeContactChannel(picked: ContactChannel, offered: readonly ContactChannel[]): ContactChannel | undefined {
  return offered.includes(picked) ? picked : offered[0];
}
