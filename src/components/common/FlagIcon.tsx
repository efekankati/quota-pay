import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Rect, Path, Circle, Polygon, G } from 'react-native-svg';
import { SupportedLanguage } from '../../i18n/translations';

interface FlagIconProps {
  code: SupportedLanguage | string;
  size?: number;
  style?: ViewStyle;
}

export const FlagIcon: React.FC<FlagIconProps> = ({ code, size = 20, style }) => {
  const normalized = (code || 'en').toLowerCase() as SupportedLanguage;

  const renderFlagContent = () => {
    switch (normalized) {
      case 'it':
        // Italian Tricolor (Green, White, Red)
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect x="0" y="0" width="10.67" height="32" fill="#009246" />
            <Rect x="10.67" y="0" width="10.67" height="32" fill="#FFFFFF" />
            <Rect x="21.34" y="0" width="10.67" height="32" fill="#CE2B37" />
          </Svg>
        );

      case 'tr':
        // Turkish Crescent and Star
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect width="32" height="32" fill="#E30A17" />
            <Circle cx="13" cy="16" r="8" fill="#FFFFFF" />
            <Circle cx="15.2" cy="16" r="6.4" fill="#E30A17" />
            <Polygon
              points="20.8,12.6 22,14.8 24.5,15.1 22.7,16.8 23.2,19.2 21,17.9 18.8,19.2 19.3,16.8 17.5,15.1 20,14.8"
              fill="#FFFFFF"
            />
          </Svg>
        );

      case 'es':
        // Spanish Tricolor with Emblem
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect x="0" y="0" width="32" height="8" fill="#AA151B" />
            <Rect x="0" y="8" width="32" height="16" fill="#F1BF00" />
            <Rect x="0" y="24" width="32" height="8" fill="#AA151B" />
            <Circle cx="10" cy="16" r="4" fill="#AA151B" opacity={0.85} />
            <Circle cx="10" cy="16" r="2.5" fill="#F1BF00" />
          </Svg>
        );

      case 'de':
        // German Tricolor (Black, Red, Gold)
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect x="0" y="0" width="32" height="10.67" fill="#000000" />
            <Rect x="0" y="10.67" width="32" height="10.67" fill="#DD0000" />
            <Rect x="0" y="21.34" width="32" height="10.67" fill="#FFCE00" />
          </Svg>
        );

      case 'fr':
        // French Tricolor (Blue, White, Red)
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect x="0" y="0" width="10.67" height="32" fill="#002654" />
            <Rect x="10.67" y="0" width="10.67" height="32" fill="#FFFFFF" />
            <Rect x="21.34" y="0" width="10.67" height="32" fill="#ED2939" />
          </Svg>
        );

      case 'en':
      default:
        // British Union Jack
        return (
          <Svg width={size} height={size} viewBox="0 0 32 32">
            <Rect width="32" height="32" fill="#012169" />
            {/* White diagonals */}
            <Path d="M0,0 L32,32 M32,0 L0,32" stroke="#FFFFFF" strokeWidth="6" />
            {/* Red diagonals */}
            <Path d="M0,0 L32,32" stroke="#C8102E" strokeWidth="2.5" />
            <Path d="M32,0 L0,32" stroke="#C8102E" strokeWidth="2.5" />
            {/* White St George cross */}
            <Path d="M16,0 L16,32 M0,16 L32,16" stroke="#FFFFFF" strokeWidth="10" />
            {/* Red St George cross */}
            <Path d="M16,0 L16,32 M0,16 L32,16" stroke="#C8102E" strokeWidth="6" />
          </Svg>
        );
    }
  };

  return (
    <View
      style={[
        styles.circleContainer,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        style,
      ]}
    >
      {renderFlagContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  circleContainer: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 1.5,
    elevation: 2,
  },
});
