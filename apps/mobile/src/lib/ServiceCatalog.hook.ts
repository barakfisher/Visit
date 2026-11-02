import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { validateService } from '@visit/contracts';
import { apiRequest, ApiError } from './api';
import { useAppLocale } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';
import { emptyServiceDraft, serviceDraft, serviceInput, type CatalogService, type ServiceDraft } from './ServiceDraft';

type Action = { kind: 'save' } | { kind: 'delete'; id: string };
export function useServiceCatalog(businessId: string) {
  const { t, locale, direction } = useAppLocale();
  const client = useQueryClient();
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}`;
  const services = useQuery({ queryKey: ['provider', businessId, 'services'], queryFn: () => apiRequest<{ services: CatalogService[] }>(`${base}/services`) });
  const staff = useQuery({ queryKey: ['provider', businessId, 'staff'], queryFn: () => apiRequest<{ staff: { id: string; displayName: string; active: boolean }[] }>(`${base}/staff`) });
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(emptyServiceDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  // `message` reports a finished action under the list; `formError` stays inside the open form with the draft.
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [formError, setFormError] = useState<MessageKey | ''>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: async (action: Action) => {
      if (action.kind === 'delete') return apiRequest<{ deleted: boolean; archived: boolean }>(`${base}/services/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
      const input = serviceInput(draft, !!editing);
      const validation = validateService(input);
      if (Object.keys(validation).length) { setErrors(validation); throw new Error('validation'); }
      const url = editing ? `${base}/services/${encodeURIComponent(editing)}` : selectedStaff.length ? `/api/provider/services?businessId=${encodeURIComponent(businessId)}` : `${base}/services`;
      return apiRequest(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...(!editing && selectedStaff.length ? { staffIds: selectedStaff } : {}) }) });
    },
    onSuccess: async (result, action) => {
      if (action.kind === 'save') closeForm();
      setDeleting(null);
      setMessage(action.kind === 'delete' ? (result as { archived?: boolean }).archived ? 'catalog.keptHistory' : 'catalog.removed' : 'catalog.saved');
      // Catalog, discovery, provider detail, slots and agendas all depend on services.
      await client.invalidateQueries({ predicate: query => ['provider', 'providers', 'public', 'availability', 'slots', 'provider-detail'].includes(String(query.queryKey[0])) });
    },
    onError: (error, action) => {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      if (error instanceof Error && error.message === 'validation') return;
      if (action.kind === 'save') setFormError('catalog.failed'); else setMessage('catalog.deleteFailed');
    },
  });
  const busy = mutation.isPending;
  function resetForm(next: ServiceDraft, id: string | null) { setDraft(next); setEditing(id); setSelectedStaff([]); setErrors({}); setFormError(''); }
  function openAdd() { resetForm(emptyServiceDraft(), null); setDeleting(null); setMessage(''); setFormOpen(true); }
  function openEdit(service: CatalogService) { resetForm(serviceDraft(service), service.id); setDeleting(null); setMessage(''); setFormOpen(true); }
  function closeForm() { setFormOpen(false); resetForm(emptyServiceDraft(), null); }
  /** A pending save keeps the form open, so its result always lands where the owner is looking. */
  function cancelForm() { if (!busy) closeForm(); }
  function update<K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) { setDraft(current => ({ ...current, [key]: value })); setErrors({}); setFormError(''); }
  function toggleStaff(id: string) { setSelectedStaff(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  function save() { setFormError(''); mutation.mutate({ kind: 'save' }); }
  function askDelete(id: string | null) { setDeleting(id); setMessage(''); }
  function confirmDelete(id: string) { mutation.mutate({ kind: 'delete', id }); }
  const deletingPending = busy && mutation.variables?.kind === 'delete' ? mutation.variables.id : null;
  return { t, locale, direction, services, staff, formOpen, draft, editing, selectedStaff, deleting, deletingPending, message, formError, errors, busy, openAdd, openEdit, cancelForm, update, toggleStaff, save, askDelete, confirmDelete };
}
export type ServiceCatalogState = ReturnType<typeof useServiceCatalog>;
