export type FooterIcon = 'home' | 'appointments' | 'add' | 'team';
export type FooterTab = { key: FooterIcon; label: string; active: boolean; onPress: () => void };
export type FooterNavigationProps = { tabs: FooterTab[] };
