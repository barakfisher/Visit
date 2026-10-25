import { Redirect } from 'expo-router';
// Retain existing bookmarks without a second account screen or bottom tab.
export default function LegacyAccount() { return <Redirect href="/account" />; }
