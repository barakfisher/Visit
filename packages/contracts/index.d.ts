export const SERVICE_CURRENCIES: readonly string[];
export const MAX_PRICE_MINOR: number;
export type ServiceInput = { name: string; description?: string | null; durationMinutes: number; priceMinor?: number | null; currency?: string | null; active?: boolean };
export function validateService(input: unknown, partial?: boolean): Record<string, string>;
export function parseServicePrice(text: string): number | null | undefined;
export function safeAuthReturnTo(value: unknown): string | undefined;
export declare const PILOT_TIMEZONE: 'Asia/Jerusalem';

export declare function providerSharePath(slug: unknown): string | undefined;

export declare const LIVE_READY_EVENT: string;
export declare const LIVE_HEARTBEAT_MS: number;
export declare const LIVE_SILENCE_LIMIT_MS: number;
export declare const CUSTOMER_SEARCH_MIN_LETTERS: number;
export declare const CUSTOMER_SEARCH_MIN_DIGITS: number;
export declare function customerSearchKind(text: string): { byName: boolean; byPhone: boolean; digits: string };
