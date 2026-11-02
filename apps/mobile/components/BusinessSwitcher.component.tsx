import { Pressable, View } from 'react-native';
import { AppText } from './AppText';
export function BusinessSwitcher({ businesses, activeId, onSelect }: { businesses: { id: string; name: string }[]; activeId: string; onSelect: (id: string) => void }) {
  if (businesses.length < 2) return null;
  return <View className="flex-row flex-wrap gap-2">{businesses.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: item.id === activeId }} onPress={() => onSelect(item.id)} className={`rounded-control border px-4 py-3 ${item.id === activeId ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}><AppText className="font-semibold text-brand">{item.name}</AppText></Pressable>)}</View>;
}
