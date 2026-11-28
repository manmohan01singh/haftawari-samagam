import React, { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ThemeContext, radii, spacing, typography, type ThemeColors, type ThemeContextValue } from '../../theme';

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
  static contextType = ThemeContext;

  // No `context` field is redeclared: Component's base type already
  // carries it (as any), and a redeclared field breaks both tsc
  // (TS2612) and Metro's Babel (no `declare` class-field support).
  // render() casts it to ThemeContextValue at the use site instead.
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
    const { colors } = this.context as ThemeContextValue;
    const styles = createStyles(colors);
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <MaterialIcons name="error-outline" size={44} color={colors.textSecondary} />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            This screen hit a snag and could not be shown. Your account and recordings are fine —
            try again, and if it keeps happening, reopen the app.
          </Text>
          {/* TEMP DIAGNOSTIC (28 Nov 2026): surface the error while
              hunting the Results -> Home crash. Remove once fixed. */}
          <Text style={styles.message}>{String(this.state.error?.message ?? '')}</Text>
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.text,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    backgroundColor: colors.subscribeBackground,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.subscribeText },
});
