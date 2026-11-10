import { Text, View } from 'react-native';
import type { BookingReviewProps } from '../src/types/BookingReview.types';
export function BookingReview(p: BookingReviewProps) {
  return <View accessibilityLabel={p.heading} className={`gap-2 ${p.heading ? 'rounded-card border border-line bg-surface p-4' : ''}`}>{p.heading ? <Text accessibilityRole="header" className="text-xl font-bold text-ink">{p.heading}</Text> : null}<Text>{p.businessAndService}</Text><Text className="font-semibold text-ink">{p.timeAndStaff}</Text>{p.replaces ? <Text className="text-body">{p.replaces}</Text> : null}<Text>{p.durationAndPrice}</Text>{p.cancellation ? <Text>{p.cancellation}</Text> : null}{p.warning ? <Text className="font-semibold text-warning">{p.warning}</Text> : null}<Text>{p.advisory}</Text></View>;
}
