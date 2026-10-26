import { AccountMethodsView } from './AccountMethods.component';
import { useAccountMethods } from './AccountMethods.hook';
export function AccountMethods(props: Parameters<typeof useAccountMethods>[0]) { return <AccountMethodsView {...useAccountMethods(props)} />; }
