import { NavigationView } from './NavigationView.component';
import { useAppNavigation } from '../src/lib/AppNavigation.hook';
export function AppNavigation() {
  const view = useAppNavigation();
  return view ? <NavigationView {...view} /> : null;
}
