import { Text } from '@react-three/drei';
import monoFont from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff?url';
import type { ComponentProps } from 'react';

type TextProps = ComponentProps<typeof Text>;

/** JetBrains Mono SDF text with sensible defaults for HUD-like labels in the world. */
export function Label({ children, color = '#e9edf7', fontSize = 0.4, glow = false, ...rest }: TextProps & { glow?: boolean }) {
  return (
    <Text font={monoFont} fontSize={fontSize} color={color} anchorX="center" anchorY="middle" {...rest}>
      {children}
      <meshBasicMaterial color={color} toneMapped={!glow} transparent depthWrite={false} />
    </Text>
  );
}
