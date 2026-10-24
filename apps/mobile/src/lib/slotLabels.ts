type LabelledSlot = { staffId: string; staffName: string; localTime: string; utcOffset: string };
export function slotLabels(slots: readonly LabelledSlot[]) {
  const offsets = new Map<string, Set<string>>();
  for (const slot of slots) {
    const key = `${slot.staffId}:${slot.localTime}`;
    const group = offsets.get(key) ?? new Set<string>();
    group.add(slot.utcOffset); offsets.set(key, group);
  }
  return slots.map(slot => `${slot.localTime}${offsets.get(`${slot.staffId}:${slot.localTime}`)!.size > 1 ? ` (UTC${slot.utcOffset})` : ''} · ${slot.staffName}`);
}
