import { FooterNavigation } from './FooterNavigation.component';
import { useAppFooter } from '../src/lib/AppFooter.hook';
export function AppFooter() {
  const tabs = useAppFooter();
  return tabs ? <FooterNavigation tabs={tabs} /> : null;
}
