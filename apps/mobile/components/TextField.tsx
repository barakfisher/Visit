import { useId, useState } from 'react';
import { Platform, TextInput, View, type TextInputProps } from 'react-native';
import { startAlignment } from '@/src/design/nativeDirection';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';
import { RequiredMark } from './RequiredMark.component';

/** `required` puts a "*" after the label; a field without it is optional, and says nothing more. */
type Props = TextInputProps & { label: string; hint?: string; error?: string; identifier?: boolean; required?: boolean };
export function TextField({ label, hint, error, identifier, required = false, editable = true, style, onFocus, onBlur, ...props }: Props) {
  const id = useId(), [focused, setFocused] = useState(false);
  const { direction } = useAppLocale();
  return <View style={{ gap: 8, minWidth: 0 }}>
    <AppText nativeID={`${id}-label`} className="font-medium text-ink">{label}{required ? <RequiredMark /> : null}</AppText>
    <TextInput placeholderTextColor={tokens.color.disabled} {...props} editable={editable} accessibilityLabel={props.accessibilityLabel ?? label} accessibilityHint={error ?? hint}
      {...(Platform.OS === 'web' ? { 'aria-describedby': error || hint ? `${id}-help` : undefined, 'aria-invalid': !!error, 'aria-required': required } : {})}
      onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
      style={[{ minHeight: tokens.layout.minTouchTarget, minWidth: 0, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, borderWidth: focused || error ? 2 : 1, borderColor: error ? tokens.color.danger : focused ? tokens.color.focus : tokens.color.controlLine, backgroundColor: editable ? tokens.color.surface : tokens.color.canvas, color: tokens.color.ink, fontSize: tokens.typography.body, ...(identifier ? { textAlign: 'left' as const } : startAlignment(Platform.OS, direction)), writingDirection: identifier ? 'ltr' : direction }, style]} />
    {error || hint ? <AppText nativeID={`${id}-help`} accessibilityRole={error ? 'alert' : undefined} style={{ color: error ? tokens.color.danger : tokens.color.body, fontSize: tokens.typography.caption }}>{error ?? hint}</AppText> : null}
  </View>;
}
