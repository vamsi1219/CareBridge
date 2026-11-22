import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  verifyDummyOtp,
} from '../services/authService';
import { colors, tabularNums } from '../theme/colors';

type Props = {
  onBackToLogin: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen({ onBackToLogin }: Props) {
  const { register } = useAuth();
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [relationshipLabel, setRelationshipLabel] = useState('');
  const [otpShown, setOtpShown] = useState(false);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGetOtp = () => {
    setError(null);
    if (!isValidMobile(mobile)) {
      setError('Enter a 10-digit mobile number.');
      return;
    }
    setOtpShown(true);
  };

  const onCreate = async () => {
    setError(null);
    if (!fullName.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!isValidMobile(mobile)) {
      setError('Enter a 10-digit mobile number.');
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email or leave it empty.');
      return;
    }
    if (!city.trim()) {
      setError('Enter your city.');
      return;
    }
    if (!otpShown) {
      setError('Get the OTP first.');
      return;
    }
    const r = verifyDummyOtp(digits.join(''));
    if (!r.ok) {
      setError('Invalid OTP. Enter 111111 to verify.');
      return;
    }
    setBusy(true);
    try {
      await register({
        fullName: fullName.trim(),
        phone: normalizeMobile(mobile),
        email: email.trim(),
        city: city.trim(),
        relationshipLabel: relationshipLabel.trim(),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.canvas}
      contentContainerStyle={styles.canvasContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.title}>The Family Care Hub</Text>
        <Text style={styles.tagline}>
          Every visit, every pill, every sibling—in sync.
        </Text>

        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Aarav Rao"
          placeholderTextColor={colors.textSecondary}
          value={fullName}
          onChangeText={setFullName}
          editable={!busy}
        />

        <Text style={styles.label}>Mobile number</Text>
        <TextInput
          style={[styles.input, tabularNums]}
          keyboardType="phone-pad"
          placeholder="10-digit mobile number"
          placeholderTextColor={colors.textSecondary}
          value={mobile}
          onChangeText={setMobile}
          maxLength={16}
          editable={!busy}
        />

        <Text style={styles.label}>Email address (optional)</Text>
        <TextInput
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          editable={!busy}
        />

        <Text style={styles.label}>City</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Hyderabad"
          placeholderTextColor={colors.textSecondary}
          value={city}
          onChangeText={setCity}
          editable={!busy}
        />

        <Text style={styles.label}>Relationship note (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Son, Daughter, Sibling"
          placeholderTextColor={colors.textSecondary}
          value={relationshipLabel}
          onChangeText={setRelationshipLabel}
          editable={!busy}
        />

        {!otpShown ? (
          <Pressable
            accessibilityRole="button"
            onPress={onGetOtp}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Get OTP</Text>
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
          </>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCreate}
          style={({ pressed }) => [
            styles.primaryButton,
            (pressed || busy) && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Create account</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={onBackToLogin}
        style={styles.link}
      >
        <Text style={styles.linkText}>Already have an account? Login</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  canvasContent: {
    flexGrow: 1,
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
    marginTop: 12,
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
  secondaryButton: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
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
