import { Linking } from 'react-native';
import { apiRequest } from './api';
import type { ProviderAgenda, AgendaBlockInput } from '../types/ProviderAgenda.types';
export function readProviderAgenda(businessId: string, date: string, mode: 'day' | 'week', signal?: AbortSignal) { return apiRequest<ProviderAgenda>(`/api/provider/agenda?${new URLSearchParams({ businessId, date, days: mode === 'week' ? '7' : '1' })}`, { signal }); }
export function saveAgendaBlock(input: AgendaBlockInput) { return apiRequest('/api/provider/block-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
export function removeAgendaBlock(businessId: string, id: string) { return apiRequest(`/api/provider/block-time/${encodeURIComponent(id)}?${new URLSearchParams({ businessId })}`, { method: 'DELETE' }); }
export function openAgendaContact(phone: string, mode: 'call' | 'whatsapp') {
  const normalized = phone.trim();
  if (!/^\+?[0-9]{7,15}$/.test(normalized)) return Promise.reject(new Error('Invalid phone number.'));
  return Linking.openURL(mode === 'call' ? `tel:${normalized}` : `https://wa.me/${normalized.replace(/\D/g, '')}`);
}
