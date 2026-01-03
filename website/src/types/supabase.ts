import type { User as SupabaseUser } from '@supabase/supabase-js';

// Extended User type that includes user_metadata
export interface ExtendedUser extends SupabaseUser {
  user_metadata: {
    full_name?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    avatar_url?: string;
    picture?: string;
    [key: string]: any;
  };
}

// Type guard to check if user has user_metadata
export function isExtendedUser(user: SupabaseUser): user is ExtendedUser {
  return user && typeof user === 'object' && 'user_metadata' in user;
}

// Helper function to safely access user_metadata
export function getUserMetadata(user: SupabaseUser): ExtendedUser['user_metadata'] {
  if (isExtendedUser(user)) {
    return user.user_metadata || {};
  }
  return {};
}

// Helper function to get display name from user
export function getUserDisplayName(user: SupabaseUser): string {
  const metadata = getUserMetadata(user);
  
  // Try different name fields in order of preference
  if (metadata.full_name) return metadata.full_name;
  if (metadata.name) return metadata.name;
  if (metadata.given_name && metadata.family_name) {
    return `${metadata.given_name} ${metadata.family_name}`;
  }
  if (metadata.given_name) return metadata.given_name;
  
  // Fallback to email
  return user.email || 'User';
}

// Helper function to get avatar URL from user
export function getUserAvatarUrl(user: SupabaseUser): string | undefined {
  const metadata = getUserMetadata(user);
  return metadata.avatar_url || metadata.picture;
}