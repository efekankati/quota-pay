import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Check, Clock } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS } from '../../config/theme';
import { ParticipantPaymentStatus } from '../../types/bill';

interface AvatarProps {
  name?: string | null;
  avatarUrl?: string;
  size?: number;
  status?: ParticipantPaymentStatus;
  isSelected?: boolean;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  avatarUrl,
  size = 44,
  status,
  isSelected = false,
}) => {
  const { colors } = useThemeStore();

  const getInitials = (fullName?: string | null) => {
    if (!fullName || typeof fullName !== 'string') {
      return 'QU';
    }
    const cleanName = fullName.replace(/\s*\(.*?\)\s*/g, '').trim();
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].toUpperCase();
    }
    return 'QU';
  };

  const badgeSize = Math.max(Math.round(size * 0.4), 16);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surfaceMuted,
            borderColor: isSelected ? colors.accent : colors.border,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
          />
        ) : (
          <Text
            style={[
              styles.initials,
              {
                color: isSelected ? colors.accent : colors.textPrimary,
                fontSize: size * 0.36,
              },
            ]}
          >
            {getInitials(name)}
          </Text>
        )}
      </View>

      {status && (
        <View
          style={[
            styles.statusBadge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: status === 'paid' ? colors.accent : colors.amber,
              borderColor: colors.surface,
            },
          ]}
        >
          {status === 'paid' ? (
            <Check size={badgeSize * 0.65} color="#000000" strokeWidth={3} />
          ) : (
            <Clock size={badgeSize * 0.65} color="#000000" strokeWidth={2.5} />
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
