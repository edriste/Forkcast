import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

const paperColors = ['#FF8A24', '#FFC857', '#FF647C', '#8D7BEE', '#58C9C0'];

export function Confetti({ celebration, reduced }: { celebration: number; reduced: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);
  const seen = useRef(0);
  useEffect(() => {
    if (!celebration || reduced) {
      seen.current = celebration;
      setVisible(false);
      return;
    }
    if (seen.current === celebration) return;
    seen.current = celebration;
    setVisible(true);
    progress.setValue(0);
    const burst = Animated.timing(progress, {
      toValue: 1,
      duration: 2200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    burst.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => burst.stop();
  }, [celebration, reduced, progress]);
  if (!visible) return null;
  return (
    <View
      testID="lunch-confetti"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {Array.from({ length: 32 }, (_, i) => {
        const direction = i % 2 ? 1 : -1;
        const spread = direction * (30 + ((i * 37) % 100));
        const rise = 45 + ((i * 23) % 105);
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: 122,
              left: 126,
              width: i % 3 === 0 ? 7 : 5,
              height: i % 3 === 0 ? 7 : 12,
              borderRadius: i % 3 === 0 ? 4 : 1,
              backgroundColor: paperColors[i % paperColors.length],
              opacity: progress.interpolate({
                inputRange: [0, 0.05, 0.75, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, spread],
                  }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 0.4, 1],
                    outputRange: [0, -rise, 105 + ((i * 13) % 70)],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [i * 29 + 'deg', i * 29 + direction * 540 + 'deg'],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
