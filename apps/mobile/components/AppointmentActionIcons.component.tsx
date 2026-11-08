import { View } from 'react-native';

/* Drawn from Views rather than an icon font or SVG: the app ships neither on web. */
const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants' } as const;

export function CalendarIcon({ color }: { color: string }) {
  return <View {...hidden} style={{ width: 22, height: 22 }}>
    <View style={{ position: 'absolute', top: 3, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: color, borderRadius: 3 }} />
    <View style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 2, backgroundColor: color }} />
    {[5, 15].map(left => <View key={left} style={{ position: 'absolute', top: 0, left, width: 2, height: 6, backgroundColor: color }} />)}
  </View>;
}

export function SmsIcon({ color }: { color: string }) {
  return <View {...hidden} style={{ width: 24, height: 22 }}>
    <View style={{ width: 24, height: 17, borderWidth: 2, borderColor: color, borderRadius: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {[0, 1, 2].map(dot => <View key={dot} style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: color }} />)}
    </View>
    <View style={{ position: 'absolute', top: 15, left: 6, width: 2, height: 6, backgroundColor: color, transform: [{ rotate: '35deg' }] }} />
  </View>;
}

/** A generic round chat bubble with a handset, not the WhatsApp trademark. */
export function WhatsappIcon({ color }: { color: string }) {
  return <View {...hidden} style={{ width: 22, height: 22 }}>
    <View style={{ width: 21, height: 21, borderWidth: 2, borderColor: color, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 9, height: 9, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderColor: color, borderBottomLeftRadius: 7 }} />
    </View>
    <View style={{ position: 'absolute', bottom: 0, left: 1, width: 2, height: 6, backgroundColor: color, transform: [{ rotate: '40deg' }] }} />
  </View>;
}
