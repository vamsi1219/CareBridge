import React, { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { colors, tabularNums } from '../theme/colors';

export default function OtpInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const refs = useRef<Array<TextInputInstance | null>>([]);

  const onChangeText = (i: number, text: string) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    const copy = [...values];
    copy[i] = digit;
    onChange(copy);
    if (digit && i < 5) refs.current[i + 1]?.focus();
  };

  const onKeyPress = (i: number, e: { nativeEvent: { key: string } }) => {
    if (e.nativeEvent.key === 'Backspace' && values[i] === '' && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  return (
    <View style={styles.row}>
      {values.map((value, i) => (
        <TextInput
          key={i}
          ref={(el: TextInputInstance | null) => {
            refs.current[i] = el;
          }}
          value={value}
          onChangeText={text => onChangeText(i, text)}
          onKeyPress={e => onKeyPress(i, e)}
          keyboardType="number-pad"
          maxLength={1}
          style={[styles.box, tabularNums]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  box: {
    width: 44,
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 22,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
});
