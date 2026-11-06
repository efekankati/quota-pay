import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface GoogleBrandIconProps {
  size?: number;
}

/**
 * Official Google 4-Color Brand Logo
 * Standard official vector used across Google Identity / OAuth SDKs.
 */
export const GoogleBrandIcon: React.FC<GoogleBrandIconProps> = ({ size = 20 }) => {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Blue */}
      <Path
        d="M23.49 12.275c0-.85-.075-1.67-.215-2.46H12v4.655h6.44c-.28 1.48-1.12 2.735-2.38 3.58v2.975h3.855c2.255-2.075 3.575-5.13 3.575-8.75z"
        fill="#4285F4"
      />
      {/* Green */}
      <Path
        d="M12 24c3.24 0 5.955-1.075 7.94-2.92l-3.855-2.975c-1.075.72-2.45 1.15-4.085 1.15-3.14 0-5.8-2.12-6.75-4.975H1.24v3.075C3.255 20.315 7.325 24 12 24z"
        fill="#34A853"
      />
      {/* Yellow */}
      <Path
        d="M5.25 14.28c-.24-.72-.375-1.49-.375-2.28s.135-1.56.375-2.28V6.645H1.24C.45 8.215 0 9.99 0 12s.45 3.785 1.24 5.355l4.01-3.075z"
        fill="#FBBC05"
      />
      {/* Red */}
      <Path
        d="M12 4.75c1.765 0 3.35.61 4.595 1.8l3.445-3.445C17.95 1.18 15.235 0 12 0 7.325 0 3.255 3.685 1.24 7.645l4.01 3.075c.95-2.855 3.61-4.97 6.75-4.97z"
        fill="#EA4335"
      />
    </Svg>
  );
};
