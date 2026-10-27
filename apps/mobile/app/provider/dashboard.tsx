import { ProviderAgenda } from '@/components/ProviderAgenda.component';
import { useProviderAgenda } from '@/src/lib/ProviderAgenda.hook';
export default function ProviderDashboard() { return <ProviderAgenda {...useProviderAgenda()} />; }
