import { Linking } from 'react-native';
import { apiRequest } from './api';
import type { ProviderAgenda } from '../types/ProviderAgenda.types';
/** One day, or the week (Sunday to Saturday) holding `date`: the home reads today, the calendar a week or a day. */
export function readProviderAgenda(businessId: string, date: string, signal?: AbortSignal, days: 1 | 3 | 7 = 1) { return apiRequest<ProviderAgenda>(`/api/provider/agenda?${new URLSearchParams({ businessId, date, days: String(days) })}`, { signal }); }
export function openAgendaContact(phone: string, mode: 'call' | 'whatsapp') {
  const normalized = phone.trim();
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) return Promise.reject(new Error('Invalid phone number.'));
  return Linking.openURL(mode === 'call' ? `tel:${normalized}` : `https://wa.me/${normalized.replace(/\D/g, '')}`);
}
