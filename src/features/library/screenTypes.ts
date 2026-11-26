/**
 * Navigation param list for the library stream.
 *
 * `History` and `Playlist` already exist in RootStackParamList. `Saved`
 * and `Playlists` are NEW routes this stream adds — the merger must
 * register them in RootNavigator and can fold these two entries into
 * RootStackParamList (see this stream's final report). Keeping the
 * extension here lets every library screen stay fully typed without
 * editing the shared navigation files from a parallel worktree.
 */
import type { RootStackParamList } from '../../navigation/types';

export type LibraryRootStackParamList = RootStackParamList & {
  /** Saved videos screen (src/screens/saved). */
  Saved: undefined;
  /** All playlists list screen (src/screens/playlists). */
  Playlists: undefined;
};
