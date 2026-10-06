/**
 * QuiProxyUrlField.tsx — The single masked "qui Proxy URL" input shown in the
 * add/edit server forms when the auth method is "qui Proxy" (#272).
 *
 * Renders card rows (leading separator included) so it drops straight into an
 * existing card under a SettingRow: a masked URL input with an eye toggle, an
 * inline parse error, a resolved preview line (key masked) and a hint. The URL
 * embeds the qui Client API key, so it is masked by default and never echoed
 * unmasked anywhere except the input itself.
 *
 * Key exports: QuiProxyUrlField
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/context/ThemeContext';
import {
  QUI_KEY_MASK,
  QuiProxyParseError,
  buildQuiProxyUrl,
  parseQuiProxyUrl,
} from '@/utils/quiProxy';

interface QuiProxyUrlFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Hint under the field (defaults to the primary-URL instructions). */
  hint?: string;
}

const ERROR_KEYS: Record<Exclude<QuiProxyParseError, 'empty'>, string> = {
  scheme: 'server.quiProxyErrorScheme',
  host: 'server.quiProxyErrorHost',
  port: 'server.quiProxyErrorPort',
  proxyPath: 'server.quiProxyErrorProxyPath',
};

export function QuiProxyUrlField({ value, onChangeText, hint }: QuiProxyUrlFieldProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);

  const parsed = useMemo(() => parseQuiProxyUrl(value), [value]);
  const errorKey = !parsed.ok && parsed.error !== 'empty' ? ERROR_KEYS[parsed.error] : null;
  const preview = parsed.ok
    ? buildQuiProxyUrl({
        host: parsed.host,
        port: parsed.port,
        useHttps: parsed.useHttps,
        basePath: parsed.basePath,
        quiProxyKey: QUI_KEY_MASK,
      })
    : null;

  return (
    <>
      <View style={[styles.separator, { backgroundColor: colors.surfaceOutline }]} />
      <View style={styles.inputRow}>
        <Ionicons name="link-outline" size={20} color={colors.primary} style={styles.inputIcon} />
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={t('placeholders.quiProxyUrl')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('server.quiProxyUrl')}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="none"
          autoComplete="off"
          passwordRules=""
        />
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          style={styles.eyeButton}
          accessibilityLabel={visible ? t('server.quiProxyHideUrl') : t('server.quiProxyShowUrl')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={visible ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
      {errorKey && <Text style={[styles.hintText, { color: colors.error }]}>{t(errorKey)}</Text>}
      {preview && (
        <Text style={[styles.hintText, { color: colors.textSecondary }]}>
          {t('server.quiProxyPreview', { url: preview })}
        </Text>
      )}
      <Text style={[styles.hintText, { color: colors.textSecondary }]}>
        {hint ?? t('server.quiProxyHint')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },
  eyeButton: {
    padding: 4,
    marginLeft: 8,
  },
  separator: {
    height: 1,
    marginLeft: 48,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
});
