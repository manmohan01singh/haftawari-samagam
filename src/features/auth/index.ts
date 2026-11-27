export { AuthProvider, useAuth, type AuthState } from './AuthContext';
export { authRedirectUrl, friendlyAuthError, type FriendlyAuthError } from './authHelpers';
export { GoogleSignInButton } from './components/GoogleSignInButton';
export { OrDivider } from './components/OrDivider';
export {
  extractMetadataProfile,
  mergeProfileWithMetadata,
  syncProfileFromMetadata,
  type MetadataProfile,
} from './profileSync';
