import { View } from 'react-native';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { PolicyFormView } from './PolicyEditor.component';
import { usePolicyEditor, usePolicyForm } from './PolicyEditor.hook';
export function PolicyEditor({ businessId }: { businessId: string }) {
  const { t, base, query } = usePolicyEditor({ businessId });
  return query.data ? <PolicyForm initial={query.data.policy ?? query.data.defaults} businessId={businessId} base={base} /> : <View className="gap-3"><AppText>{t(query.isError ? 'setup.failure' : 'common.loading')}</AppText>{query.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void query.refetch()} /> : null}</View>;
}
function PolicyForm(props: Parameters<typeof usePolicyForm>[0]) { return <PolicyFormView {...usePolicyForm(props)} />; }
