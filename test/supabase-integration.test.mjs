import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Supabase client
const mockSupabaseClient = {
  auth: {
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  },
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn(),
  })),
};

// Mock the Supabase module
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

// Import after mocking
const { auth, db, migration } = await import('../website/src/lib/supabase.ts');

describe('Supabase Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock successful authentication
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
  });

  describe('Authentication', () => {
    it('should sign in with Google', async () => {
      mockSupabaseClient.auth.signInWithOAuth.mockResolvedValue({
        data: { url: 'https://oauth-url.com' },
        error: null,
      });

      const result = await auth.signInWithGoogle();
      
      expect(mockSupabaseClient.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: expect.stringContaining('/auth/callback'),
        },
      });
      
      expect(result.error).toBeNull();
    });

    it('should sign out', async () => {
      mockSupabaseClient.auth.signOut.mockResolvedValue({ error: null });

      const result = await auth.signOut();
      
      expect(mockSupabaseClient.auth.signOut).toHaveBeenCalled();
      expect(result.error).toBeNull();
    });

    it('should get current user', async () => {
      const mockUser = { id: 'test-user-id', email: 'test@example.com' };
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });

      const result = await auth.getCurrentUser();
      
      expect(result.user).toEqual(mockUser);
      expect(result.error).toBeNull();
    });

    it('should get current session', async () => {
      const mockSession = { user: { id: 'test-user-id' }, access_token: 'token' };
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      const result = await auth.getCurrentSession();
      
      expect(result.session).toEqual(mockSession);
      expect(result.error).toBeNull();
    });
  });

  describe('Database Operations - Tracks', () => {
    const mockTrack = {
      id: 'track-1',
      name: 'Test Track',
      code: 's("bd hh")',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
    };

    it('should get all tracks', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.order.mockResolvedValue({
        data: [mockTrack],
        error: null,
      });

      const result = await db.tracks.getAll();
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(mockChain.order).toHaveBeenCalledWith('modified', { ascending: false });
      expect(result.data).toEqual([mockTrack]);
    });

    it('should get single track', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.single.mockResolvedValue({
        data: mockTrack,
        error: null,
      });

      const result = await db.tracks.get('track-1');
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('id', 'track-1');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(result.data).toEqual(mockTrack);
    });

    it('should create track', async () => {
      const newTrack = { ...mockTrack, user_id: 'test-user-id' };
      const mockChain = mockSupabaseClient.from();
      mockChain.single.mockResolvedValue({
        data: newTrack,
        error: null,
      });

      const result = await db.tracks.create(mockTrack);
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.insert).toHaveBeenCalledWith({ ...mockTrack, user_id: 'test-user-id' });
      expect(result.data).toEqual(newTrack);
    });

    it('should update track', async () => {
      const updates = { name: 'Updated Track', code: 's("bd sd")' };
      const mockChain = mockSupabaseClient.from();
      mockChain.single.mockResolvedValue({
        data: { ...mockTrack, ...updates },
        error: null,
      });

      const result = await db.tracks.update('track-1', updates);
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.update).toHaveBeenCalledWith({
        ...updates,
        modified: expect.any(String),
      });
      expect(mockChain.eq).toHaveBeenCalledWith('id', 'track-1');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    });

    it('should delete track', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.delete.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await db.tracks.delete('track-1');
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.delete).toHaveBeenCalled();
      expect(mockChain.eq).toHaveBeenCalledWith('id', 'track-1');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(result.error).toBeNull();
    });

    it('should bulk insert tracks', async () => {
      const tracks = [mockTrack, { ...mockTrack, id: 'track-2', name: 'Track 2' }];
      const tracksWithUserId = tracks.map(track => ({ ...track, user_id: 'test-user-id' }));
      
      const mockChain = mockSupabaseClient.from();
      mockChain.select.mockResolvedValue({
        data: tracksWithUserId,
        error: null,
      });

      const result = await db.tracks.bulkInsert(tracks);
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.insert).toHaveBeenCalledWith(tracksWithUserId);
      expect(result.data).toEqual(tracksWithUserId);
    });
  });

  describe('Database Operations - Folders', () => {
    const mockFolder = {
      id: 'folder-1',
      name: 'Test Folder',
      path: '/test',
      created: '2024-01-01T00:00:00Z',
    };

    it('should get all folders', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.order.mockResolvedValue({
        data: [mockFolder],
        error: null,
      });

      const result = await db.folders.getAll();
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('folders');
      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(mockChain.order).toHaveBeenCalledWith('name');
      expect(result.data).toEqual([mockFolder]);
    });

    it('should create folder', async () => {
      const newFolder = { ...mockFolder, user_id: 'test-user-id' };
      const mockChain = mockSupabaseClient.from();
      mockChain.single.mockResolvedValue({
        data: newFolder,
        error: null,
      });

      const result = await db.folders.create(mockFolder);
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('folders');
      expect(mockChain.insert).toHaveBeenCalledWith({ ...mockFolder, user_id: 'test-user-id' });
      expect(result.data).toEqual(newFolder);
    });
  });

  describe('Migration', () => {
    beforeEach(() => {
      // Mock localStorage
      global.localStorage = {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
    });

    it('should check if user has migrated', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.limit.mockResolvedValue({
        data: [{ id: 'track-1' }],
        error: null,
      });

      const result = await migration.hasMigrated();
      
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('tracks');
      expect(mockChain.select).toHaveBeenCalledWith('id');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
      expect(mockChain.limit).toHaveBeenCalledWith(1);
      expect(result).toBe(true);
    });

    it('should migrate from localStorage', async () => {
      const mockTracks = {
        'track-1': {
          id: 'track-1',
          name: 'Local Track',
          code: 's("bd")',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
        },
      };

      const mockFolders = {
        'folder-1': {
          id: 'folder-1',
          name: 'Local Folder',
          path: '/local',
          created: '2024-01-01T00:00:00Z',
        },
      };

      global.localStorage.getItem.mockImplementation((key) => {
        if (key === 'strudel_tracks') return JSON.stringify(mockTracks);
        if (key === 'strudel_folders') return JSON.stringify(mockFolders);
        return null;
      });

      // Mock successful bulk inserts
      const mockChain = mockSupabaseClient.from();
      mockChain.select.mockResolvedValue({
        data: [Object.values(mockTracks)[0]],
        error: null,
      });

      const result = await migration.migrateFromLocalStorage();
      
      expect(result.tracks.success).toBe(1);
      expect(result.tracks.errors).toHaveLength(0);
      expect(result.folders.success).toBe(1);
      expect(result.folders.errors).toHaveLength(0);
    });

    it('should clear localStorage after migration', () => {
      migration.clearLocalStorage();
      
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('strudel_tracks');
      expect(global.localStorage.removeItem).toHaveBeenCalledWith('strudel_folders');
      expect(global.localStorage.setItem).toHaveBeenCalledWith('strudel_migrated_to_supabase', 'true');
    });

    it('should check if localStorage has been cleared', () => {
      global.localStorage.getItem.mockReturnValue('true');
      
      const result = migration.isLocalStorageCleared();
      
      expect(global.localStorage.getItem).toHaveBeenCalledWith('strudel_migrated_to_supabase');
      expect(result).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      });

      await expect(db.tracks.getAll()).rejects.toThrow('Not authenticated');
    });

    it('should handle database errors', async () => {
      const mockChain = mockSupabaseClient.from();
      mockChain.order.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await db.tracks.getAll();
      
      expect(result.error).toEqual({ message: 'Database error' });
    });

    it('should handle migration errors gracefully', async () => {
      global.localStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage error');
      });

      const result = await migration.migrateFromLocalStorage();
      
      expect(result.tracks.errors).toHaveLength(1);
      expect(result.folders.errors).toHaveLength(1);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete user workflow', async () => {
      // 1. User signs in
      mockSupabaseClient.auth.signInWithOAuth.mockResolvedValue({
        data: { url: 'oauth-url' },
        error: null,
      });

      await auth.signInWithGoogle();

      // 2. User creates a track
      const newTrack = {
        id: 'new-track',
        name: 'My Track',
        code: 's("bd hh")',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      };

      const mockChain = mockSupabaseClient.from();
      mockChain.single.mockResolvedValue({
        data: { ...newTrack, user_id: 'test-user-id' },
        error: null,
      });

      const createResult = await db.tracks.create(newTrack);
      expect(createResult.data.name).toBe('My Track');

      // 3. User updates the track
      const updates = { code: 's("bd sd hh")' };
      mockChain.single.mockResolvedValue({
        data: { ...newTrack, ...updates, user_id: 'test-user-id' },
        error: null,
      });

      const updateResult = await db.tracks.update('new-track', updates);
      expect(updateResult.data.code).toBe('s("bd sd hh")');

      // 4. User gets all tracks
      mockChain.order.mockResolvedValue({
        data: [{ ...newTrack, ...updates, user_id: 'test-user-id' }],
        error: null,
      });

      const getAllResult = await db.tracks.getAll();
      expect(getAllResult.data).toHaveLength(1);
    });
  });
});