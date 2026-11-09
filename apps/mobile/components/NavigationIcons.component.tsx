import { View } from 'react-native';
import { physicalDrawing } from '@/src/design/nativeDirection';

/* Drawn from Views rather than an icon font or SVG: the app ships neither on web. */
const hidden = { accessible: false, importantForAccessibility: 'no-hide-descendants' } as const;
type IconProps = { color: string };

export function CloseIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
    {['45deg', '-45deg'].map(rotate => <View key={rotate} style={{ position: 'absolute', width: 20, height: 2, borderRadius: 1, backgroundColor: color, transform: [{ rotate }] }} />)}
  </View>;
}

export function AvatarIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color, alignItems: 'center', overflow: 'hidden' }}>
    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color, marginTop: 4 }} />
    <View style={{ width: 18, height: 14, borderRadius: 9, backgroundColor: color, marginTop: 2 }} />
  </View>;
}

export function BellIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 24, height: 24, alignItems: 'center' }}>
    <View style={{ width: 16, height: 15, marginTop: 2, borderLeftWidth: 2, borderRightWidth: 2, borderTopWidth: 2, borderColor: color, borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
    <View style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: color }} />
    <View style={{ width: 6, height: 3, marginTop: 1, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: color }} />
  </View>;
}

export function HomeIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 22, height: 22, alignItems: 'center' }}>
    <View style={{ ...physicalDrawing, width: 15, height: 15, marginTop: 2, borderLeftWidth: 2, borderTopWidth: 2, borderColor: color, transform: [{ rotate: '45deg' }] }} />
    <View style={{ position: 'absolute', bottom: 0, width: 15, height: 12, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: color, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
  </View>;
}

export function TeamIcon({ color }: IconProps) {
  const person = (left: number) => <View key={left} style={{ position: 'absolute', left, top: 3, alignItems: 'center' }}>
    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
    <View style={{ width: 11, height: 7, marginTop: 1, borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: color }} />
  </View>;
  return <View {...hidden} style={{ width: 24, height: 22 }}>{[0, 13].map(person)}</View>;
}

export function PlusIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: 10, height: 2, backgroundColor: color }} />
    <View style={{ position: 'absolute', width: 2, height: 10, backgroundColor: color }} />
  </View>;
}

export function ShareIcon({ color }: IconProps) {
  const dot = (left: number, top: number) => <View key={`${left}-${top}`} style={{ position: 'absolute', left, top, width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />;
  const line = (top: number, rotate: string) => <View key={rotate} style={{ position: 'absolute', left: 3, top, width: 12, height: 1.5, backgroundColor: color, transform: [{ rotate }] }} />;
  return <View {...hidden} style={{ ...physicalDrawing, width: 18, height: 18 }}>
    {line(5, '-27deg')}{line(11.5, '27deg')}{dot(0, 6)}{dot(12, 0)}{dot(12, 12)}
  </View>;
}

export function GlobeIcon({ color }: IconProps) {
  return <View {...hidden} style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: 8, height: 15, borderRadius: 4, borderWidth: 1.5, borderColor: color }} />
    <View style={{ position: 'absolute', width: 15, height: 1.5, backgroundColor: color }} />
  </View>;
}
