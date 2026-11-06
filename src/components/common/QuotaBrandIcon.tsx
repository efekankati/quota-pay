import React from 'react';
import Svg, { Circle, Path, G } from 'react-native-svg';

interface QuotaBrandIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Custom Theme-Appropriate Quota "Q" Brand Icon
 * Clean geometric neo-fintech styling with a circular ring and sharp 45-degree angled tail.
 */
export const QuotaBrandIcon: React.FC<QuotaBrandIconProps> = ({
  size = 24,
  color = '#00E599',
  strokeWidth = 3,
}) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <G
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Main circular body of the Q */}
        <Circle cx="15" cy="14" r="9" />
        {/* Distinctive dynamic angled tail */}
        <Path d="M17.5 16.5L25 24" />
      </G>
    </Svg>
  );
};
