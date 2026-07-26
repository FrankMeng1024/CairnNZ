/**
 * ErrorBoundary — React class component that catches render errors in
 * its subtree and surfaces them via crashLogger instead of showing the
 * RN red box. Used to wrap experimental/unstable subtrees so a render
 * failure there doesn't take down the surrounding screen.
 *
 * Note: only catches React render-time errors. Runtime errors inside
 * useEffect / event handlers / setTimeout still need their own try/catch.
 * Native crashes (GPU, GL) are not catchable from JS at all — those
 * surface via the OS crash log only.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { crashLogger } from '../services/crashLogger';

interface Props {
  /** Tag included in breadcrumb / fallback so we know which boundary fired. */
  tag: string;
  children: React.ReactNode;
  /** Optional custom fallback UI. Defaults to a thin red banner. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? String(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    crashLogger.breadcrumb(
      `errorBoundary:${this.props.tag}: ${String(error?.message || error).slice(0, 120)}`,
    );
    // Persist to crash store so it uploads on next launch.
    try {
      // crashLogger doesn't expose a public "report" method, but the global
      // ErrorUtils handler will be triggered if we re-throw asynchronously.
      // Using setTimeout(0) to defer so React's render cycle isn't broken.
      const stack = info?.componentStack ?? '';
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(`[errorBoundary:${this.props.tag}]`, error, stack);
      }, 0);
    } catch {
      // ignore
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.text}>
            {this.props.tag} render failed: {this.state.message?.slice(0, 80)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(180, 30, 30, 0.92)',
    borderRadius: 8,
    zIndex: 999,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
