import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Home } from 'lucide-react-native';
import { QuotaBrandIcon } from './QuotaBrandIcon';
import { useThemeStore } from '../../store/useThemeStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

export type MainTabType = 'home' | 'quotas' | 'profile';

interface OneUIBottomNavProps {
  activeTab: MainTabType;
  onTabChange: (tab: MainTabType) => void;
}

/**
 * Clean bottom navigation bar with crisp highlighting:
 * - Highlights only the icon/logo and label (no background rectangle box)
 * - Quotas tab with official Q logo
 * - Profile tab with initials avatar
 */
export const OneUIBottomNav: React.FC<OneUIBottomNavProps> = ({
  activeTab,
  onTabChange,
}) => {
  const { colors } = useThemeStore();
  const { user } = useAuthStore();
  const { t } = useLanguageStore();
  const { lightImpact } = useHaptics();

  const handlePress = (tab: MainTabType) => {
    if (activeTab !== tab) {
      lightImpact();
      onTabChange(tab);
    }
  };

  const initials = user?.fullName?.slice(0, 2).toUpperCase() || 'QU';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
        },
      ]}
    >
      {/* Tab 1: Home */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handlePress('home')}
        style={styles.tabButton}
      >
        <View style={styles.iconContainer}>
          <Home
            size={24}
            color={activeTab === 'home' ? colors.accent : colors.textTertiary}
            strokeWidth={activeTab === 'home' ? 2.6 : 2}
          />
        </View>
        <Text
          style={[
            styles.tabLabel,
            {
              color: activeTab === 'home' ? colors.accent : colors.textTertiary,
              fontWeight: activeTab === 'home' ? '800' : '600',
            },
          ]}
        >
          {t('homeNav')}
        </Text>
      </TouchableOpacity>

      {/* Tab 2: Quotas (App "Q" Logo) */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handlePress('quotas')}
        style={styles.tabButton}
      >
        <View style={styles.iconContainer}>
          <QuotaBrandIcon
            size={24}
            color={activeTab === 'quotas' ? colors.accent : colors.textTertiary}
            strokeWidth={activeTab === 'quotas' ? 2.8 : 2.2}
          />
        </View>
        <Text
          style={[
            styles.tabLabel,
            {
              color: activeTab === 'quotas' ? colors.accent : colors.textTertiary,
              fontWeight: activeTab === 'quotas' ? '800' : '600',
            },
          ]}
        >
          {t('quotasNav')}
        </Text>
      </TouchableOpacity>

      {/* Tab 3: Profile (Initials Avatar) */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handlePress('profile')}
        style={styles.tabButton}
      >
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.avatarCircle,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor:
                  activeTab === 'profile' ? colors.accent : colors.border,
                borderWidth: activeTab === 'profile' ? 2 : 1,
                overflow: 'hidden',
              },
            ]}
          >
            {user?.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={{ width: 26, height: 26, borderRadius: 13 }}
                resizeMode="cover"
              />
            ) : (
              <Text
                style={[
                  styles.avatarInitials,
                  {
                    color: activeTab === 'profile' ? colors.accent : colors.textSecondary,
                    fontWeight: activeTab === 'profile' ? '900' : '700',
                  },
                ]}
              >
                {initials}
              </Text>
            )}
          </View>
        </View>
        <Text
          style={[
            styles.tabLabel,
            {
              color: activeTab === 'profile' ? colors.accent : colors.textTertiary,
              fontWeight: activeTab === 'profile' ? '800' : '600',
            },
          ]}
        >
          {t('profileNav')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    height: Platform.OS === 'ios' ? 80 : 66,
    paddingBottom: Platform.OS === 'ios' ? 18 : 6,
    paddingTop: 6,
    borderTopWidth: 1,
    alignItems: 'center',
    justifyContent: 'space-around',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 10,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconContainer: {
    width: 32,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: -0.2,
  },
  qLogoBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  qLogoImage: {
    width: 22,
    height: 22,
  },
  avatarCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 10,
  },
});
