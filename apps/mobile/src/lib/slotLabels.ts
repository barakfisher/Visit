import { translate, type Locale } from '../i18n/messages';
type LabelledSlot = { staffId: string; staffName: string; localTime: string; utcOffset: string };
export function slotLabels(slots: readonly LabelledSlot[], locale: Locale = 'en') {
  const offsets = new Map<string, Set<string>>();
  for (const slot of slots) {
    const key = `${slot.staffId}:${slot.localTime}`;
    const group = offsets.get(key) ?? new Set<string>();
    group.add(slot.utcOffset); offsets.set(key, group);
  }
  return slots.map(slot => {
    const minutes = (offset: string) => (offset.startsWith('-') ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
    const group = [...offsets.get(`${slot.staffId}:${slot.localTime}`)!].sort((a, b) => minutes(b) - minutes(a));
    const occurrence = group.length > 1 ? translate(locale, group.indexOf(slot.utcOffset) === 0 ? 'time.first' : 'time.second') : undefined;
    return `${slot.localTime}${occurrence ? ` (${occurrence})` : ''} · ${slot.staffName}`;
  });
}
