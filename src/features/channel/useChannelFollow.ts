import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Honest DEVICE-LOCAL follow state for a channel.
 *
 * There is no subscriptions backend, so this persists in AsyncStorage
 * on this device only — the same `channel-follow:<id>` key the Channel
 * screen uses, so the Search channel card and the Channel screen
 * always agree. It drives nothing fake: no subscriber counts change,
 * and it is never presented as a YouTube subscription.
 */
export function useChannelFollow(channelId: string): {
  following: boolean;
  toggleFollow: () => void;
} {
  const [following, setFollowing] = useState(false);
  const followKey = `channel-follow:${channelId}`;

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(followKey)
      .then((value) => {
        if (active) setFollowing(value === '1');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [followKey]);

  const toggleFollow = useCallback(() => {
    setFollowing((prev) => {
      const next = !prev;
      void AsyncStorage.setItem(followKey, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, [followKey]);

  return { following, toggleFollow };
}
