import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { useLocale } from '../../providers/Locale';
import { useTheme } from '../ui';
import { Confetti } from './Confetti';

const foodIcons = [
  'pizza',
  'cafe',
  'restaurant',
  'fish',
  'fast-food',
  'ice-cream',
  'nutrition',
  'restaurant',
] as const;
const radius = 102;
const wedge = radius * Math.tan(Math.PI / 8);
const slices = [
  '#FF8A24',
  '#FFC857',
  '#FFB56B',
  '#FF7555',
  '#FF8A24',
  '#FFC857',
  '#FFB56B',
  '#FF7555',
];

export function LunchWheel({
  spinning,
  options,
  celebration = 0,
}: {
  spinning: boolean;
  options: number;
  celebration?: number;
}) {
  const { colors } = useTheme();
  const { t } = useLocale();
  const reduced = useReducedMotion();
  const rotation = useRef(new Animated.Value(0)).current;
  const wheelElement = useRef<HTMLElement | null>(null);
  const wheelAngle = useRef(0);
  const bounce = useRef(new Animated.Value(1)).current;
  const finishedPick = useRef(0);
  useEffect(() => {
    if (reduced) {
      rotation.stopAnimation();
      return;
    }
    if (!spinning) return;
    if (Platform.OS === 'web' && wheelElement.current?.animate) {
      const element = wheelElement.current;
      const from = wheelAngle.current;
      const spin = element.animate(
        [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${from + 360}deg)` }],
        { duration: 700, iterations: Infinity, easing: 'linear' },
      );
      return () => {
        wheelAngle.current = from + ((Number(spin.currentTime) || 0) / 700) * 360;
        element.style.transform = 'rotate(' + wheelAngle.current + 'deg)';
        spin.cancel();
      };
    }
    rotation.setValue(0);
    const spin = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 700,
        isInteraction: false,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    spin.start();
    return () => spin.stop();
  }, [spinning, reduced, rotation]);
  useEffect(() => {
    if (!celebration || reduced) {
      finishedPick.current = celebration;
      return;
    }
    if (finishedPick.current === celebration) return;
    finishedPick.current = celebration;
    const element = Platform.OS === 'web' ? wheelElement.current : null;
    let settle: Animation | undefined;
    if (element?.animate) {
      const target = wheelAngle.current + 270;
      settle = element.animate(
        [
          { transform: 'rotate(' + wheelAngle.current + 'deg)' },
          { transform: 'rotate(' + target + 'deg)' },
        ],
        { duration: 550, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' },
      );
      settle.onfinish = () => {
        element.style.transform = 'rotate(' + target + 'deg)';
        wheelAngle.current = target;
        settle?.cancel();
      };
    }
    const finish = Animated.parallel([
      ...(element?.animate
        ? []
        : [
            Animated.timing(rotation, {
              toValue: 1.75,
              duration: 550,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
              isInteraction: false,
            }),
          ]),
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1.12, duration: 140, useNativeDriver: true }),
        Animated.spring(bounce, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]),
    ]);
    finish.start();
    return () => {
      settle?.cancel();
      finish.stop();
      bounce.setValue(1);
    };
  }, [celebration, reduced, rotation, bounce]);
  return (
    <View
      accessibilityLabel={t('Restaurant wheel')}
      style={{ alignSelf: 'center', width: 260, gap: 10, alignItems: 'center' }}
    >
      <View style={{ width: 260, height: 252, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            width: 130,
            height: 18,
            borderRadius: 9,
            backgroundColor: colors.light,
          }}
        />
        <View
          style={{
            position: 'absolute',
            bottom: 9,
            width: 60,
            height: 65,
            borderRadius: 14,
            backgroundColor: colors.orange,
          }}
        />
        <View
          style={{
            width: 224,
            height: 224,
            borderRadius: 112,
            backgroundColor: colors.surface,
            borderWidth: 4,
            borderColor: colors.orange,
            padding: 6,
            boxShadow: '0 8px 20px rgba(255,138,36,0.2)',
          }}
        >
          <Animated.View
            ref={(node) => {
              if (Platform.OS === 'web')
                wheelElement.current = node as unknown as HTMLElement | null;
            }}
            testID="lunch-wheel-disc"
            style={{
              width: 204,
              height: 204,
              borderRadius: 102,
              overflow: 'hidden',
              backgroundColor: colors.orange,
              transform: [
                {
                  rotate: rotation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  }),
                },
              ],
            }}
          >
            {slices.map((color, i) => (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: radius - wedge,
                  top: radius,
                  width: 0,
                  height: 0,
                  borderLeftWidth: wedge,
                  borderRightWidth: wedge,
                  borderBottomWidth: radius + 4,
                  borderLeftColor: 'transparent',
                  borderRightColor: 'transparent',
                  borderBottomColor: color,
                  transformOrigin: [wedge, 0, 0],
                  transform: [{ rotate: i * 45 + 'deg' }],
                }}
              />
            ))}
            {foodIcons.map((icon, i) => {
              const angle = ((i * 45 + 22.5) * Math.PI) / 180;
              return (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    left: 88 + 71 * Math.sin(angle),
                    top: 88 + 71 * Math.cos(angle),
                    width: 28,
                    height: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ rotate: -(i * 45 + 22.5) + 'deg' }],
                  }}
                >
                  <Ionicons name={icon} size={21} color="#783500" accessible={false} />
                </View>
              );
            })}
          </Animated.View>
          {Array.from({ length: 16 }, (_, i) => {
            const angle = (i * Math.PI) / 8;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  left: 106 + 106 * Math.sin(angle),
                  top: 106 + 106 * Math.cos(angle),
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: i % 2 ? colors.orange : colors.gold,
                }}
              />
            );
          })}
        </View>
        <Animated.View
          style={{
            position: 'absolute',
            width: 70,
            height: 70,
            borderRadius: 35,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            backgroundColor: colors.surface,
            borderWidth: 4,
            borderColor: colors.orange,
            transform: [{ scale: bounce }],
          }}
        >
          <Ionicons
            name={celebration && !spinning ? 'sparkles' : 'restaurant'}
            size={26}
            color={colors.accent}
            accessible={false}
          />
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 12 }}>{t('LUNCH')}</Text>
        </Animated.View>
        <View
          style={{
            position: 'absolute',
            top: 4,
            width: 0,
            height: 0,
            borderLeftWidth: 11,
            borderRightWidth: 11,
            borderTopWidth: 25,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: colors.ink,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 0,
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: colors.ink,
            borderWidth: 3,
            borderColor: colors.surface,
          }}
        />
        <Confetti celebration={celebration} reduced={reduced} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
        {t(options === 1 ? 'Picking from 1 restaurant' : 'Picking from {count} restaurants', {
          count: options,
        })}
      </Text>
    </View>
  );
}
