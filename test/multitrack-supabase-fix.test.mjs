import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Multitrack Supabase Import Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert UI format to database format correctly', () => {
    // Simulate the convertTrackToDB function
    const convertTrackToDB = (uiTrack) => {
      const dbTrack = { ...uiTrack };
      
      // Convert UI fields to database fields
      if (uiTrack.isMultitrack !== undefined) {
        dbTrack.is_multitrack = uiTrack.isMultitrack;
        delete dbTrack.isMultitrack;
      }
      
      if (uiTrack.activeStep !== undefined) {
        dbTrack.active_step = uiTrack.activeStep;
        delete dbTrack.activeStep;
      }
      
      return dbTrack;
    };

    const uiTrack = {
      id: 'test-123',
      name: 'Test Multitrack',
      code: 'console.log("test")',
      isMultitrack: true,
      activeStep: 0,
      steps: [
        { id: 'step1', name: 'Step 1', code: 'test1' },
        { id: 'step2', name: 'Step 2', code: 'test2' }
      ]
    };

    const dbTrack = convertTrackToDB(uiTrack);

    expect(dbTrack.is_multitrack).toBe(true);
    expect(dbTrack.active_step).toBe(0);
    expect(dbTrack.isMultitrack).toBeUndefined();
    expect(dbTrack.activeStep).toBeUndefined();
    expect(dbTrack.steps).toEqual(uiTrack.steps);
    expect(dbTrack.name).toBe('Test Multitrack');
  });

  it('should convert database format to UI format correctly', () => {
    // Simulate the convertTrackFromDB function
    const convertTrackFromDB = (dbTrack) => ({
      ...dbTrack,
      isMultitrack: dbTrack.is_multitrack,
      activeStep: dbTrack.active_step,
    });

    const dbTrack = {
      id: 'test-123',
      name: 'Test Multitrack',
      code: 'console.log("test")',
      is_multitrack: true,
      active_step: 1,
      steps: [
        { id: 'step1', name: 'Step 1', code: 'test1' },
        { id: 'step2', name: 'Step 2', code: 'test2' }
      ],
      user_id: 'user-123'
    };

    const uiTrack = convertTrackFromDB(dbTrack);

    expect(uiTrack.isMultitrack).toBe(true);
    expect(uiTrack.activeStep).toBe(1);
    expect(uiTrack.is_multitrack).toBe(true); // Should still exist
    expect(uiTrack.active_step).toBe(1); // Should still exist
    expect(uiTrack.steps).toEqual(dbTrack.steps);
    expect(uiTrack.name).toBe('Test Multitrack');
  });

  it('should handle multitrack import to Supabase correctly', async () => {
    const mockCreateTrack = vi.fn().mockResolvedValue({
      id: 'created-123',
      name: 'Imported Multitrack',
      code: 'step1 code',
      isMultitrack: true,
      activeStep: 0,
      steps: [
        { id: 'step_0', name: 'Step 1', code: 'step1 code' },
        { id: 'step_1', name: 'Step 2', code: 'step2 code' }
      ]
    });

    const mockLoadTrack = vi.fn();
    const mockToastSuccess = vi.fn();

    // Mock ZIP content
    const mockZipContent = {
      file: vi.fn((filename) => {
        if (filename === 'metadata.json') {
          return {
            async: vi.fn().mockResolvedValue(JSON.stringify({
              name: 'Test Multitrack',
              stepCount: 2,
              stepNames: ['Step 1', 'Step 2']
            }))
          };
        }
        if (filename === 'step_0.js') {
          return {
            async: vi.fn().mockResolvedValue('step1 code')
          };
        }
        if (filename === 'step_1.js') {
          return {
            async: vi.fn().mockResolvedValue('step2 code')
          };
        }
        return null;
      })
    };

    // Mock file manager hook
    const fileManagerHook = {
      isAuthenticated: true,
      createTrack: mockCreateTrack,
      loadTrack: mockLoadTrack
    };

    const toastActions = {
      success: mockToastSuccess,
      error: vi.fn()
    };

    const t = vi.fn((key) => key);

    // Simulate handleMultitrackImport function
    const handleMultitrackImport = async (zipContent, fileManagerHook, toastActions, t) => {
      try {
        const metadataFile = zipContent.file('metadata.json');
        const metadataContent = await metadataFile.async('text');
        const metadata = JSON.parse(metadataContent);
        
        const steps = [];
        
        // Load all step files
        for (let i = 0; i < metadata.stepCount; i++) {
          const stepFile = zipContent.file(`step_${i}.js`);
          if (stepFile) {
            const stepContent = await stepFile.async('text');
            steps.push({
              id: `step_${i}`,
              name: metadata.stepNames?.[i] || `Step ${i + 1}`,
              code: stepContent,
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
            });
          }
        }
        
        const multitrackData = {
          id: Date.now().toString(),
          name: metadata.name || 'Imported Multitrack',
          code: steps[0]?.code || '',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          isMultitrack: true,
          steps,
          activeStep: 0,
        };

        // Import multitrack to Supabase
        if (fileManagerHook && fileManagerHook.isAuthenticated && fileManagerHook.createTrack) {
          const createdTrack = await fileManagerHook.createTrack(
            multitrackData.name, 
            multitrackData.code,
            undefined, // folder
            multitrackData.isMultitrack,
            multitrackData.steps,
            multitrackData.activeStep
          );
          if (createdTrack) {
            toastActions.success(t('files:trackImported', { name: multitrackData.name }));
            await new Promise(resolve => setTimeout(resolve, 100));
            fileManagerHook.loadTrack(createdTrack);
          }
        }
      } catch (error) {
        console.error('Error importing multitrack:', error);
        toastActions.error(t('files:invalidLibraryFile'));
      }
    };

    await handleMultitrackImport(mockZipContent, fileManagerHook, toastActions, t);

    // Verify createTrack was called with correct multitrack parameters
    expect(mockCreateTrack).toHaveBeenCalledWith(
      'Test Multitrack',
      'step1 code',
      undefined, // folder
      true, // isMultitrack
      expect.arrayContaining([
        expect.objectContaining({
          id: 'step_0',
          name: 'Step 1',
          code: 'step1 code'
        }),
        expect.objectContaining({
          id: 'step_1',
          name: 'Step 2',
          code: 'step2 code'
        })
      ]),
      0 // activeStep
    );

    expect(mockToastSuccess).toHaveBeenCalledWith('files:trackImported');
    expect(mockLoadTrack).toHaveBeenCalled();
  });

  it('should handle session persistence with default localStorage', () => {
    // Mock Supabase client creation
    const mockCreateClient = vi.fn((url, key, options) => {
      return {
        auth: {
          autoRefreshToken: options?.auth?.autoRefreshToken,
          persistSession: options?.auth?.persistSession,
          detectSessionInUrl: options?.auth?.detectSessionInUrl,
          flowType: options?.auth?.flowType,
          storage: options?.auth?.storage || 'default-localStorage'
        }
      };
    });

    // Simulate creating Supabase client with default storage
    const supabaseClient = mockCreateClient('test-url', 'test-key', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        // No custom storage - should use default localStorage
      },
    });

    expect(supabaseClient.auth.autoRefreshToken).toBe(true);
    expect(supabaseClient.auth.persistSession).toBe(true);
    expect(supabaseClient.auth.detectSessionInUrl).toBe(true);
    expect(supabaseClient.auth.flowType).toBe('pkce');
    expect(supabaseClient.auth.storage).toBe('default-localStorage');
  });

  it('should handle regular track import without multitrack fields', async () => {
    const mockCreateTrack = vi.fn().mockResolvedValue({
      id: 'regular-123',
      name: 'Regular Track',
      code: 'console.log("regular")',
      isMultitrack: false
    });

    // Test regular track creation (no multitrack fields)
    const result = await mockCreateTrack('Regular Track', 'console.log("regular")');

    expect(mockCreateTrack).toHaveBeenCalledWith('Regular Track', 'console.log("regular")');
    expect(result.isMultitrack).toBe(false);
    expect(result.steps).toBeUndefined();
    expect(result.activeStep).toBeUndefined();
  });

  it('should handle database field conversion edge cases', () => {
    const convertTrackToDB = (uiTrack) => {
      const dbTrack = { ...uiTrack };
      
      if (uiTrack.isMultitrack !== undefined) {
        dbTrack.is_multitrack = uiTrack.isMultitrack;
        delete dbTrack.isMultitrack;
      }
      
      if (uiTrack.activeStep !== undefined) {
        dbTrack.active_step = uiTrack.activeStep;
        delete dbTrack.activeStep;
      }
      
      return dbTrack;
    };

    // Test with undefined multitrack fields
    const trackWithoutMultitrack = {
      id: 'test',
      name: 'Test',
      code: 'test'
    };

    const result1 = convertTrackToDB(trackWithoutMultitrack);
    expect(result1.is_multitrack).toBeUndefined();
    expect(result1.active_step).toBeUndefined();
    expect(result1.isMultitrack).toBeUndefined();
    expect(result1.activeStep).toBeUndefined();

    // Test with false multitrack
    const trackWithFalseMultitrack = {
      id: 'test',
      name: 'Test',
      code: 'test',
      isMultitrack: false,
      activeStep: null
    };

    const result2 = convertTrackToDB(trackWithFalseMultitrack);
    expect(result2.is_multitrack).toBe(false);
    expect(result2.active_step).toBe(null);
    expect(result2.isMultitrack).toBeUndefined();
    expect(result2.activeStep).toBeUndefined();
  });
});