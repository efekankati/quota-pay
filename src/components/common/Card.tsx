import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SHADOWS, SPACING } from '../../config/theme';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'elevated' | 'flat' | 'accent';
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  variant = 'elevated',
}) => {
  const { colors } = useThemeStore();

  const getBackgroundColor = () => {
    switch (variant) {
      case 'accent':
        return colors.accentLight;
      case 'flat':
        return colors.surfaceMuted;
      case 'elevated':
      default:
        return colors.surface;
    }
  };

  const getBorderColor = () => {
    switch (variant) {
      case 'accent':
        return colors.accent;
      default:
        return colors.border;
    }
  };

  return (
    <View
      style={[
        styles.baseCard,
        SHADOWS.card,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  baseCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
  },
});
