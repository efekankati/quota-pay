import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Plus, UserCheck } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { Participant } from '../../types/bill';
import { Avatar } from '../common/Avatar';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface ParticipantSelectorProps {
  participants: Participant[];
  selectedParticipantId: string;
  onSelectParticipant: (id: string) => void;
  onAddParticipant: () => void;
}

export const ParticipantSelector: React.FC<ParticipantSelectorProps> = ({
  participants,
  selectedParticipantId,
  onSelectParticipant,
  onAddParticipant,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { selectionChanged, lightImpact } = useHaptics();

  return (
    <View style={styles.wrapper}>
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
        {t('dinersAtTableSection')}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {participants.map((p) => {
          const isSelected = p.id === selectedParticipantId;
          return (
            <TouchableOpacity
              key={p.id}
              activeOpacity={0.8}
              onPress={() => {
                selectionChanged();
                onSelectParticipant(p.id);
              }}
              style={[
                styles.participantTab,
                {
                  backgroundColor: isSelected ? colors.surfaceElevated : colors.surface,
                  borderColor: isSelected ? colors.accent : colors.border,
                },
              ]}
            >
              <Avatar
                name={p.name}
                size={34}
                isSelected={isSelected}
                status={p.status}
              />
              <View style={styles.nameBlock}>
                <Text
                  style={[
                    styles.participantName,
                    { color: isSelected ? colors.accent : colors.textPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {p.name.split(' ')[0]}
                </Text>
                {p.isOrganizer && (
                  <Text style={[styles.organizerLabel, { color: colors.textTertiary }]}>
                    {t('organizerBadge')}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Add Participant Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            lightImpact();
            onAddParticipant();
          }}
          style={[
            styles.addTab,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
          ]}
          accessibilityLabel={t('addDiner')}
        >
          <Plus size={18} color={colors.textPrimary} />
          <Text style={[styles.addText, { color: colors.textPrimary }]}>{t('addDiner')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
  },
  participantTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1.5,
  },
  nameBlock: {
    justifyContent: 'center',
  },
  participantName: {
    fontSize: 14,
    fontWeight: '700',
  },
  organizerLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  addTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
