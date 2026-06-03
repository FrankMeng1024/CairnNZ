import { useRef } from 'react';
import { Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export function useBackFade(duration = 200) {
  const nav = useNavigation();
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const goBack = () => {
    nav.goBack();
  };

  return { fadeAnim, goBack };
}
