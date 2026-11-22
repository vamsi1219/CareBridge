import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import OtpInput from '../components/OtpInput';
import { useAuth } from '../hooks/useAuth';
import {
  isValidMobile,
  normalizeMobile,
  requestDummyOtp,
  verifyDummyOtp,
} from '../services/authService';
import { colors, tabularNums } from '../theme/colors';

type Props = {
  onGoToRegister: () => void;
};

export default function LoginScreen({ onGoToRegister }: Props) {
  const { login } = useAuth();
  const [mobile, setMobile] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGetOtp = async () => {
    setError(null);
    if (!isValidMobile(mobile)) {
      setError('Enter a 10-digit mobile number.');
      return;
    }
    setBusy(true);
    try {
      await requestDummyOtp(normalizeMobile(mobile));
      setOtpRequested(true);
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_REGISTERED') {
        setError('Mobile number not found. Please register first.');
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    const r = verifyDummyOtp(digits.join(''));
    if (!r.ok) {
      setError('Invalid OTP. Enter 111111 to verify.');
      return;
    }
    setBusy(true);
    try {
      await login(normalizeMobile(mobile));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.canvas}>
      <View style={styles.card}>
        <Text style={styles.title}>The Family Care Hub</Text>
        <Text style={styles.tagline}>
          Every visit, every pill, every sibling—in sync.
        </Text>

        <Text style={styles.label}>Mobile number</Text>
        <TextInput
          style={[styles.input, tabularNums]}
          keyboardType="phone-pad"
          placeholder="10-digit mobile number"
          placeholderTextColor={colors.textSecondary}
          value={mobile}
          onChangeText={setMobile}
          maxLength={16}
          editable={!busy && !otpRequested}
        />

        {!otpRequested ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onGetOtp}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || busy) && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Get OTP</Text>
            )}
          </Pressable>
        ) : (
          <>
            <Text style={styles.label}>Enter the 6-digit code</Text>
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                Demo mode: use the test code 111111.
              </Text>
            </View>
            <OtpInput values={digits} onChange={setDigits} />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onVerify}
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || busy) && styles.pressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>Verify</Text>
              )}
            </Pressable>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={onGoToRegister}
        style={styles.link}
      >
        <Text style={styles.linkText}>Not having your account? Register</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  tagline: {
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: 20,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  primaryButton: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
  banner: {
    backgroundColor: '#FFFBEB',
    borderLeftWidth: 4,
    borderLeftColor: colors.amber,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  bannerText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  error: {
    color: colors.error,
    fontSize: 14,
    marginTop: 12,
  },
  link: {
    marginTop: 20,
    paddingVertical: 8,
  },
  linkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
