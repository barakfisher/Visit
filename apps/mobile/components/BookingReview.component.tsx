import { Text, View } from 'react-native';
import type { BookingReviewProps } from '../src/types/BookingReview.types';
export function BookingReview(p: BookingReviewProps) {
  return <View accessibilityLabel={p.heading} className="gap-2 rounded-card border border-line bg-surface p-4"><Text accessibilityRole="header" className="text-xl font-bold text-ink">{p.heading}</Text><Text>{p.businessAndService}</Text><Text>{p.timeAndStaff}</Text><Text>{p.durationAndPrice}</Text><Text>{p.cancellation}</Text><Text>{p.advisory}</Text></View>;
}
