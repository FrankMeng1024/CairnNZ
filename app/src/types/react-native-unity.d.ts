// Type shim for @azesmway/react-native-unity 1.0.11.
// The library's package.json points "types" to a non-existent path
// (lib/typescript/index.d.ts), but the actual file lives at
// lib/typescript/src/index.d.ts. Re-export from there here so TS
// resolves the module without relying on the broken types entry.

declare module '@azesmway/react-native-unity' {
  import * as React from 'react';

  type UnityViewContentUpdateEvent = Readonly<{
    message: string;
  }>;

  // RN 0.71+ DirectEventHandler shape — kept loose so we don't depend
  // on an internal RN type path.
  type DirectEventHandler<TEvent> = (event: { nativeEvent: TEvent }) => void;

  export interface RNUnityViewProps {
    androidKeepPlayerMounted?: boolean;
    fullScreen?: boolean;
    style?: any;
    onUnityMessage?: DirectEventHandler<UnityViewContentUpdateEvent>;
    onPlayerUnload?: DirectEventHandler<UnityViewContentUpdateEvent>;
    onPlayerQuit?: DirectEventHandler<UnityViewContentUpdateEvent>;
  }

  export default class UnityView extends React.Component<RNUnityViewProps> {
    postMessage(gameObject: string, methodName: string, message: string): void;
    unloadUnity(): void;
    pauseUnity(pause: boolean): void;
    resumeUnity(): void;
    windowFocusChanged(hasFocus?: boolean): void;
  }
}
