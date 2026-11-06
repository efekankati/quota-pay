import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING } from '../../config/theme';

interface BadgeProps {
  label: string;
  variant?: 'accent' | 'blue' | 'amber' | 'crimson' | 'muted';
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'accent',
  style,
}) => {
  const { colors } = useThemeStore();

  const getColors = () => {
    switch (variant) {
      case 'accent':
        return { bg: colors.accentLight, text: colors.accent };
      case 'blue':
        return { bg: colors.blueLight, text: colors.blue };
      case 'amber':
        return { bg: colors.amberLight, text: colors.amber };
      case 'crimson':
        return { bg: colors.crimsonLight, text: colors.crimson };
      case 'muted':
      default:
        return { bg: colors.surfaceMuted, text: colors.textSecondary };
    }
  };

  const current = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: current.bg }, style]}>
      <Text style={[styles.text, { color: current.text }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xxs + 2,
    borderRadius: RADIUS.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});
