import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Check, Plus, Minus, Users } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { LineItem, Participant } from '../../types/bill';
import { Avatar } from '../common/Avatar';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface LineItemRowProps {
  item: LineItem;
  participants: Participant[];
  selectedParticipantId: string;
  onToggleAssign: () => void;
  onChangeQuantity?: (newQuantity: number) => void;
}

export const LineItemRow: React.FC<LineItemRowProps> = ({
  item,
  participants,
  selectedParticipantId,
  onToggleAssign,
  onChangeQuantity,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact } = useHaptics();

  const isMultiple = item.quantity > 1 && !item.isCoperto;

  // Claimed quantity for current selected participant
  const myClaimedCount =
    item.claimedQuantities?.[selectedParticipantId] ??
    (item.assignedParticipantIds.includes(selectedParticipantId) ? 1 : 0);

  const isClaimedBySelected = myClaimedCount > 0;

  // Calculate total claimed across all diners
  let totalClaimedAcrossDiners = 0;
  if (item.claimedQuantities) {
    Object.values(item.claimedQuantities).forEach((q) => {
      totalClaimedAcrossDiners += q;
    });
  } else {
    totalClaimedAcrossDiners = item.assignedParticipantIds.length;
  }

  const otherDinersClaimed = Math.max(totalClaimedAcrossDiners - myClaimedCount, 0);
  const remainingAvailableToClaim = Math.max(item.quantity - otherDinersClaimed, 0);
  const unassignedRemaining = Math.max(item.quantity - totalClaimedAcrossDiners, 0);

  const canIncrement = myClaimedCount < remainingAvailableToClaim;
  const canDecrement = myClaimedCount > 0;

  // List of participants assigned to this dish with their claimed count
  const assignedParticipants = participants.filter((p) =>
    item.assignedParticipantIds.includes(p.id) ||
    ((item.claimedQuantities?.[p.id] || 0) > 0)
  );

  const handleIncrement = () => {
    if (!canIncrement) return;
    lightImpact();
    if (onChangeQuantity) {
      onChangeQuantity(myClaimedCount + 1);
    } else {
      onToggleAssign();
    }
  };

  const handleDecrement = () => {
    if (!canDecrement) return;
    lightImpact();
    if (onChangeQuantity) {
      onChangeQuantity(myClaimedCount - 1);
    } else {
      onToggleAssign();
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => {
        lightImpact();
        onToggleAssign();
      }}
      style={[
        styles.rowCard,
        {
          backgroundColor: isClaimedBySelected ? colors.surfaceElevated : colors.surface,
          borderColor: isClaimedBySelected ? colors.accent : colors.border,
        },
      ]}
    >
      {/* Checkbox / Badge Indicator on Left */}
      {isMultiple ? (
        <View
          style={[
            styles.qtyIndicatorBadge,
            {
              backgroundColor: isClaimedBySelected ? colors.accentLight : colors.surfaceMuted,
              borderColor: isClaimedBySelected ? colors.accent : colors.borderSubtle,
            },
          ]}
        >
          <Text
            style={[
              styles.qtyIndicatorText,
              { color: isClaimedBySelected ? colors.accent : colors.textTertiary },
            ]}
          >
            {myClaimedCount > 0 ? `${myClaimedCount}x` : `${item.quantity}x`}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: isClaimedBySelected ? colors.accent : 'transparent',
              borderColor: isClaimedBySelected ? colors.accent : colors.border,
            },
          ]}
        >
          {isClaimedBySelected && (
            <Check size={14} color="#000000" strokeWidth={3} />
          )}
        </View>
      )}

      {/* Main Item Content */}
      <View style={styles.itemMain}>
        <View style={styles.titleRow}>
          <Text
            style={[styles.itemName, { color: colors.textPrimary }]}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.quantity > 1 && (
            <View
              style={[
                styles.totalQtyBadge,
                { backgroundColor: colors.surfaceMuted, borderColor: colors.borderSubtle },
              ]}
            >
              <Text style={[styles.totalQtyText, { color: colors.textSecondary }]}>
                {item.quantity}x tot.
              </Text>
            </View>
          )}
        </View>

        {/* Counter Stepper for Multiple-Quantity Items */}
        {isMultiple && (
          <View style={styles.counterRow}>
            <View
              style={[
                styles.stepperContainer,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: isClaimedBySelected ? colors.accent : colors.borderSubtle,
                },
              ]}
            >
              {/* Decrement Button */}
              <TouchableOpacity
                activeOpacity={0.7}
                disabled={!canDecrement}
                onPress={handleDecrement}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[
                  styles.stepperBtn,
                  {
                    backgroundColor: canDecrement ? colors.surfaceElevated : 'transparent',
                    opacity: canDecrement ? 1 : 0.35,
                  },
                ]}
              >
                <Minus
                  size={14}
                  color={canDecrement ? colors.textPrimary : colors.textTertiary}
                  strokeWidth={2.5}
                />
              </TouchableOpacity>

              {/* Counter Display Badge */}
              <View style={styles.stepperValueContainer}>
                <Text
                  style={[
                    styles.stepperCount,
                    { color: isClaimedBySelected ? colors.accent : colors.textPrimary },
                  ]}
                >
                  {myClaimedCount}
                  <Text style={[styles.stepperTotal, { color: colors.textTertiary }]}>
                    /{item.quantity}
                  </Text>
                </Text>
              </View>

              {/* Increment Button */}
              <TouchableOpacity
                activeOpacity={0.7}
                disabled={!canIncrement}
                onPress={handleIncrement}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={[
                  styles.stepperBtn,
                  {
                    backgroundColor: canIncrement ? colors.accent : 'transparent',
                    opacity: canIncrement ? 1 : 0.35,
                  },
                ]}
              >
                <Plus
                  size={14}
                  color={canIncrement ? '#000000' : colors.textTertiary}
                  strokeWidth={2.5}
                />
              </TouchableOpacity>
            </View>

            {unassignedRemaining > 0 && (
              <Text style={[styles.remainingUnassignedText, { color: colors.amber }]}>
                {t('availableRemaining', { count: unassignedRemaining })}
              </Text>
            )}
          </View>
        )}

        {/* Assigned Avatar Chips */}
        <View style={styles.avatarRow}>
          {assignedParticipants.length === 0 ? (
            <Text style={[styles.unclaimedHint, { color: colors.textTertiary }]}>
              {t('nobodyAssignedHint')}
            </Text>
          ) : (
            <View style={styles.avatarChipsContainer}>
              {assignedParticipants.map((p) => {
                const count =
                  item.claimedQuantities?.[p.id] ??
                  (item.assignedParticipantIds.includes(p.id) ? 1 : 0);
                if (count <= 0 && isMultiple) return null;

                const isMe = p.id === selectedParticipantId;
                return (
                  <View
                    key={p.id}
                    style={[
                      styles.dinerChip,
                      {
                        backgroundColor: isMe
                          ? colors.accentLight
                          : colors.surfaceMuted,
                        borderColor: isMe ? colors.accent : colors.borderSubtle,
                      },
                    ]}
                  >
                    <Avatar name={p.name} size={16} />
                    <Text
                      style={[
                        styles.chipName,
                        { color: isMe ? colors.accent : colors.textSecondary },
                      ]}
                    >
                      {p.name.split(' ')[0]}
                      {isMultiple && count > 0 ? ` (${count}x)` : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {/* Pricing block */}
      <View style={styles.pricingBlock}>
        {isMultiple && myClaimedCount > 0 ? (
          <>
            <Text style={[styles.itemTotal, { color: colors.accent }]} numberOfLines={1}>
              €{(myClaimedCount * item.unitPrice).toFixed(2)}
            </Text>
            <Text style={[styles.splitShareText, { color: colors.textSecondary }]} numberOfLines={1}>
              {myClaimedCount}x €{item.unitPrice.toFixed(2)}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.itemTotal, { color: colors.textPrimary }]} numberOfLines={1}>
              €{item.totalPrice.toFixed(2)}
            </Text>
            {item.quantity > 1 ? (
              <Text style={[styles.unitPriceText, { color: colors.textTertiary }]}>
                €{item.unitPrice.toFixed(2)} {t('eachUnit')}
              </Text>
            ) : item.assignedParticipantIds.length > 1 ? (
              <Text style={[styles.splitShareText, { color: colors.accent }]}>
                (1/{item.assignedParticipantIds.length}: €
                {(
                  item.totalPrice / Math.max(item.assignedParticipantIds.length, 1)
                ).toFixed(2)}
                )
              </Text>
            ) : null}
          </>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1.5,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    gap: SPACING.md,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyIndicatorBadge: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyIndicatorText: {
    fontSize: 12,
    fontWeight: '800',
  },
  itemMain: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  totalQtyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: RADIUS.xs,
    borderWidth: 1,
  },
  totalQtyText: {
    fontSize: 10,
    fontWeight: '700',
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginVertical: 2,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    padding: 2,
  },
  stepperBtn: {
    width: 28,
    height: 26,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValueContainer: {
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperCount: {
    fontSize: 13,
    fontWeight: '800',
  },
  stepperTotal: {
    fontSize: 11,
    fontWeight: '600',
  },
  remainingUnassignedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  unclaimedHint: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  avatarChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  dinerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  chipName: {
    fontSize: 10,
    fontWeight: '700',
  },
  pricingBlock: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 68,
  },
  itemTotal: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  splitShareText: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  unitPriceText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
