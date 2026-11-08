import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { BusinessSwitcher } from './BusinessSwitcher.component';
import { PublishedNextSteps } from './PublishedNextSteps.component';
import { useSessionStore } from '@/src/state/session';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { blockerMessages, outsideBlockers, sectionComplete, sectionHints, SETUP_SECTIONS, type BusinessReadiness, type SetupSection } from '@/src/lib/BusinessReadiness';
// The settings hub: every section opens its own screen and single-form sections return here on save (decisions.md, 2026-11-02).
export function BusinessSettings({ business, readiness }: { business: { id: string; name: string }; readiness: BusinessReadiness }) {
  const { t } = useAppLocale();
  const steps = SETUP_SECTIONS.map(key => ({ key, done: sectionComplete(readiness, key) }));
  const done = steps.filter(step => step.done).length, next = steps.find(step => !step.done)?.key;
  const profile = useSessionStore(state => state.profile);
  const select = (id: string) => { if (id !== business.id) { useSessionStore.getState().selectBusiness(id); router.replace({ pathname: '/provider/[businessId]', params: { businessId: id } }); } };
  const open = (section: SetupSection) => router.push({ pathname: '/provider/[businessId]/[section]', params: { businessId: business.id, section } });
  const hint = (key: SetupSection) => key !== 'publish' ? t(sectionHints[key]) : t(readiness.ready ? 'guide.publishReady' : 'guide.publishWaiting');
  return <ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 pb-10" className="flex-1 bg-canvas">
    <AppText accessibilityRole="header" className="text-3xl font-bold text-ink">{business.name}</AppText>
    <BusinessSwitcher businesses={profile?.businesses ?? []} activeId={business.id} onSelect={select} />
    <View className="gap-2">
      <AppText accessibilityRole="header" className="text-2xl font-bold text-ink">{t('guide.title')}</AppText>
      {next ? <>
      <AppText className="text-body">{t('guide.intro')}</AppText>
      <AppText className="font-semibold text-brand">{t('guide.progress', { done, total: steps.length })}</AppText>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="h-2 overflow-hidden rounded-control bg-line"><View className="h-2 bg-brand" style={{ width: `${(done / steps.length) * 100}%` }} /></View>
      </> : null}
    </View>
    {!next ? <PublishedNextSteps t={t} onShare={() => router.push({ pathname: '/provider/[businessId]/share', params: { businessId: business.id } })} onAgenda={() => router.push({ pathname: '/provider/dashboard', params: { businessId: business.id } })} /> : null}
    {outsideBlockers(readiness).map(code => <AppText key={code} accessibilityRole="alert" className="text-danger">{t(blockerMessages[code] ?? 'publish.failure')}</AppText>)}
    <View className="gap-3">{steps.map((step, index) => <Control key={step.key} testID={`setup-guide-${step.key}`} accessibilityRole="button" accessibilityLabel={`${t(`setup.${step.key}`)}, ${t(step.done ? 'setup.complete' : 'setup.incomplete')}`} onPress={() => open(step.key)} className="flex-row items-center gap-4 rounded-card border border-line bg-surface p-card active:bg-brand-soft">
      <View className={`h-9 w-9 items-center justify-center rounded-control ${step.done ? 'bg-brand' : 'border border-line bg-canvas'}`}><AppText className={`font-bold ${step.done ? 'text-white' : 'text-body'}`}>{step.done ? '✓' : String(index + 1)}</AppText></View>
      <View className="flex-1 gap-1"><AppText className="font-semibold text-ink">{t(`setup.${step.key}`)}</AppText><AppText className="text-sm text-body">{step.done ? t(step.key === 'publish' ? 'publish.live' : 'setup.complete') : hint(step.key)}</AppText></View>
      <AppText className="font-semibold text-brand">{t('guide.open')}</AppText>
    </Control>)}</View>
    {next ? <ActionButton label={t('guide.continue')} onPress={() => open(next)} /> : null}
  </ScrollView>;
}
