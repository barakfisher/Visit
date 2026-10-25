export const SERVICE_CURRENCIES: readonly string[];
export const MAX_PRICE_MINOR: number;
export type ServiceInput = { name: string; description?: string | null; durationMinutes: number; priceMinor?: number | null; currency?: string | null; active?: boolean };
export function validateService(input: unknown, partial?: boolean): Record<string, string>;
export function parseServicePrice(text: string): number | null | undefined;
export function safeAuthReturnTo(value: unknown): string | undefined;
export declare const PILOT_TIMEZONE: 'Asia/Jerusalem';

export declare function providerSharePath(slug: unknown): string | undefined;
