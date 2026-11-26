import React from 'react';
import { Linking, Text, type StyleProp, type TextStyle } from 'react-native';

/**
 * Text with REAL tappable links (QA issue 40): http(s) / www. URLs open
 * in the browser; phone / WhatsApp-style numbers (+91 … / 10-digit)
 * open the dialer via tel:. Everything else renders as plain text in
 * the caller's style. No link is invented — only substrings that are
 * actually present in the source text become tappable.
 */
const TOKEN_RE =
  /(https?:\/\/[^\s)]+|www\.[^\s)]+|\+\d[\d\s-]{8,}\d|\b\d{10}\b)/g;

function hrefFor(token: string): string | null {
  const trimmed = token.replace(/[.,;]+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length >= 10) return `tel:${digits}`;
  return null;
}

interface LinkedTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

export function LinkedText({ text, style, linkStyle, numberOfLines }: LinkedTextProps) {
  const parts = text.split(TOKEN_RE);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        const href = i % 2 === 1 ? hrefFor(part) : null;
        if (!href) return <Text key={i}>{part}</Text>;
        return (
          <Text
            key={i}
            style={[{ color: '#065FD4', textDecorationLine: 'underline' }, linkStyle]}
            onPress={() => {
              void Linking.openURL(href).catch(() => undefined);
            }}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}
