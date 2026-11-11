import { Linking } from 'react-native';
import { apiRequest } from './api';
import type { ProviderAgenda } from '../types/ProviderAgenda.types';
/** One day only: the home shows today. The API still serves a week (`days=7`) for a calendar screen to come. */
export function readProviderAgenda(businessId: string, date: string, signal?: AbortSignal) { return apiRequest<ProviderAgenda>(`/api/provider/agenda?${new URLSearchParams({ businessId, date, days: '1' })}`, { signal }); }
export function openAgendaContact(phone: string, mode: 'call' | 'whatsapp') {
  const normalized = phone.trim();
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) return Promise.reject(new Error('Invalid phone number.'));
  return Linking.openURL(mode === 'call' ? `tel:${normalized}` : `https://wa.me/${normalized.replace(/\D/g, '')}`);
}
