import { ScrollView } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';
import { Control } from './Control';
/** Section buttons use standard Tab/Enter/Space, rather than incomplete ARIA tabs. */
export function SectionNavigation({ label, items, selectedId, onSelect }: { label: string; items: { id: string; label: string; disabled?: boolean }[]; selectedId: string; onSelect: (id: string) => void }) {
  const { direction, t } = useAppLocale();
  return <ScrollView horizontal role="group" accessibilityLabel={label} style={{ direction }} contentContainerClassName="gap-3 px-2 py-2">
    {items.map(item => <Control key={item.id} accessibilityRole="button" aria-pressed={selectedId === item.id} accessibilityState={{ selected: selectedId === item.id, disabled: !!item.disabled }} disabled={item.disabled} onPress={() => onSelect(item.id)} className={`items-center justify-center rounded-control border px-4 py-3 ${item.disabled ? 'border-control-line bg-canvas' : item.id === selectedId ? 'border-brand bg-brand' : 'border-control-line bg-surface'}`}>
      <AppText style={{ textAlign: 'center' }} className={`font-semibold ${item.id === selectedId && !item.disabled ? 'text-white' : 'text-body'}`}>{item.id === selectedId ? '✓ ' : ''}{item.label}{item.disabled ? ` (${t('ui.unavailable')})` : ''}</AppText>
    </Control>)}
  </ScrollView>;
}
