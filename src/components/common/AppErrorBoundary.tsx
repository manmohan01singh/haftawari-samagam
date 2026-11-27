import React, { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { lightColors, radii, spacing, typography } from '../../theme';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * App-level error boundary (perf3). The app had NONE: any render
 * throw on any screen unmounted the whole tree and left a permanent
 * blank white page with no way out — observed live on 27 Nov 2026
 * (first tap on Home's "Live" tab → blank page, title "Sessions",
 * zero interactive elements, recoverable only by leaving the app
 * route entirely; the identical tap worked seconds later, so the
 * throw is transient, not a deterministic screen bug).
 *
 * With this boundary, a transient throw becomes a recoverable
 * state: the user sees what happened and taps "Try again", which
 * remounts the navigator subtree. Built only from RN primitives +
 * theme tokens so the fallback itself cannot be the thing that
 * throws. The error is logged for diagnosis.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[AppErrorBoundary]', error);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <MaterialIcons name="error-outline" size={44} color={lightColors.textSecondary} />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            This screen hit a snag and could not be shown. Your account and recordings are fine —
            try again, and if it keeps happening, reopen the app.
          </Text>
          <Pressable
            style={styles.button}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: lightColors.background,
  },
  title: {
    ...typography.sectionTitle,
    color: lightColors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  message: {
    ...typography.body,
    color: lightColors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    backgroundColor: lightColors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: lightColors.subscribeText },
});
