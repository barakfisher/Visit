import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { useAppLocale } from '@/src/i18n/LocaleContext';
export default function TabLayout() {
  const { t } = useAppLocale();
  return <Tabs screenOptions={{ tabBarActiveTintColor: '#0f766e', tabBarInactiveTintColor: '#64748b', tabBarStyle: { backgroundColor: '#fff' }, headerShown: false }}>
    <Tabs.Screen name="index" options={{ title: t('nav.discover'), tabBarIcon: ({ color }) => <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} tintColor={color} size={25}/> }}/>
    <Tabs.Screen name="two" options={{ title: t('nav.account'), tabBarIcon: ({ color }) => <SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'person' }} tintColor={color} size={25}/> }}/>
  </Tabs>;
}
