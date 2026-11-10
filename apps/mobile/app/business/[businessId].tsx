import { ProviderHome } from '@/components/ProviderHome.component';
import { useProviderHome } from '@/src/lib/ProviderHome.hook';
export default function BusinessScreen() { return <ProviderHome {...useProviderHome()} />; }
