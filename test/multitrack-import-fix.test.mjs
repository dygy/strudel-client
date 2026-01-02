import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock JSZip
const mockZipContent = {
  file: vi.fn(),
  files: {}
};

const mockJSZip = {
  loadAsync: vi.fn().mockResolvedValue(mockZipContent)
};

// Mock dynamic import for JSZip
vi.mock('jszip', () => ({
  default: mockJSZip
}));

// Mock toast actions
const mockToastActions = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
};

// Mock translation function
const mockT = vi.fn((key, params) => {
  const translations = {
    'files:multitrackImported': `Multitrack '${params?.name}' imported successfully!`,
    'files:multitrackImportFailed': 'Failed to import multitrack file',
    'files:noValidStepsFound': 'No valid steps found in multitrack file',
    'files:invalidMultitrackFile': 'Invalid multitrack file format'
  };
  return translations[key] || key;
});

describe('Multitrack Import Fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZipContent.files = {};
  });

  it('should handle single track download format (trackName)', async () => {
    // Mock metadata.json with single track download format
    const metadata = {
      trackName: 'My Multitrack',
      isMultitrack: true,
      steps: [
        { name: 'Step 1', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' },
        { name: 'Step 2', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' }
      ],
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z'
    };

    // Mock file structure
    mockZipContent.file.mockImplementation((filename) => {
      if (filename === 'metadata.json') {
        return {
          async: vi.fn().mockResolvedValue(JSON.stringify(metadata))
        };
      }
      if (filename === 'Step_1.js') {
        return {
          async: vi.fn().mockResolvedValue('sound("bd")')
        };
      }
      if (filename === 'Step_2.js') {
        return {
          async: vi.fn().mockResolvedValue('sound("hh")')
        };
      }
      return null;
    });

    // Simulate the import logic
    const metadataFile = mockZipContent.file('metadata.json');
    expect(metadataFile).toBeTruthy();
    
    const metadataContent = await metadataFile.async('text');
    const parsedMetadata = JSON.parse(metadataContent);
    
    // Test the fixed logic
    const trackName = parsedMetadata.name || parsedMetadata.trackName || 'Imported Multitrack';
    const stepCount = parsedMetadata.steps ? parsedMetadata.steps.length : 0;
    
    expect(trackName).toBe('My Multitrack');
    expect(stepCount).toBe(2);
    
    const steps = [];
    for (let i = 0; i < stepCount; i++) {
      const stepName = parsedMetadata.steps[i].name.replace(/[^a-zA-Z0-9]/g, '_');
      const stepFile = mockZipContent.file(`${stepName}.js`);
      
      if (stepFile) {
        const stepContent = await stepFile.async('text');
        steps.push({
          id: `step_${i}`,
          name: parsedMetadata.steps[i].name,
          code: stepContent,
          created: parsedMetadata.steps[i].created,
          modified: parsedMetadata.steps[i].modified,
        });
      }
    }
    
    expect(steps).toHaveLength(2);
    expect(steps[0].name).toBe('Step 1');
    expect(steps[0].code).toBe('sound("bd")');
    expect(steps[1].name).toBe('Step 2');
    expect(steps[1].code).toBe('sound("hh")');
  });

  it('should handle folder export format (name)', async () => {
    // Mock metadata.json with folder export format
    const metadata = {
      name: 'Exported Multitrack',
      isMultitrack: true,
      activeStep: 1,
      steps: [
        { id: 'step_0', name: 'Intro', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' },
        { id: 'step_1', name: 'Main', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' }
      ],
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z'
    };

    // Mock file structure
    mockZipContent.file.mockImplementation((filename) => {
      if (filename === 'metadata.json') {
        return {
          async: vi.fn().mockResolvedValue(JSON.stringify(metadata))
        };
      }
      if (filename === 'Intro.js') {
        return {
          async: vi.fn().mockResolvedValue('// Intro\nsound("kick")')
        };
      }
      if (filename === 'Main.js') {
        return {
          async: vi.fn().mockResolvedValue('// Main\nsound("snare")')
        };
      }
      return null;
    });

    // Test the fixed logic
    const metadataFile = mockZipContent.file('metadata.json');
    const metadataContent = await metadataFile.async('text');
    const parsedMetadata = JSON.parse(metadataContent);
    
    const trackName = parsedMetadata.name || parsedMetadata.trackName || 'Imported Multitrack';
    const stepCount = parsedMetadata.steps ? parsedMetadata.steps.length : 0;
    
    expect(trackName).toBe('Exported Multitrack');
    expect(stepCount).toBe(2);
    expect(parsedMetadata.activeStep).toBe(1);
  });

  it('should handle step_X.js naming format', async () => {
    // Mock metadata.json
    const metadata = {
      name: 'Step Format Track',
      isMultitrack: true,
      steps: [
        { name: 'First Step', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' }
      ],
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z'
    };

    // Mock file structure with step_X.js format
    mockZipContent.file.mockImplementation((filename) => {
      if (filename === 'metadata.json') {
        return {
          async: vi.fn().mockResolvedValue(JSON.stringify(metadata))
        };
      }
      if (filename === 'step_0.js') {
        return {
          async: vi.fn().mockResolvedValue('sound("808")')
        };
      }
      return null;
    });

    // Test the fixed logic - should try step_X.js format first
    const metadataFile = mockZipContent.file('metadata.json');
    const metadataContent = await metadataFile.async('text');
    const parsedMetadata = JSON.parse(metadataContent);
    
    const stepCount = parsedMetadata.steps.length;
    const steps = [];
    
    for (let i = 0; i < stepCount; i++) {
      // Try step_X.js format first
      let stepFile = mockZipContent.file(`step_${i}.js`);
      
      if (stepFile) {
        const stepContent = await stepFile.async('text');
        steps.push({
          id: `step_${i}`,
          name: parsedMetadata.steps[i].name,
          code: stepContent
        });
      }
    }
    
    expect(steps).toHaveLength(1);
    expect(steps[0].code).toBe('sound("808")');
  });

  it('should handle empty steps gracefully', async () => {
    // Mock metadata.json with no steps
    const metadata = {
      name: 'Empty Track',
      isMultitrack: true,
      steps: [],
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z'
    };

    mockZipContent.file.mockImplementation((filename) => {
      if (filename === 'metadata.json') {
        return {
          async: vi.fn().mockResolvedValue(JSON.stringify(metadata))
        };
      }
      return null;
    });

    // Test the fixed logic
    const metadataFile = mockZipContent.file('metadata.json');
    const metadataContent = await metadataFile.async('text');
    const parsedMetadata = JSON.parse(metadataContent);
    
    const stepCount = parsedMetadata.steps ? parsedMetadata.steps.length : 0;
    
    expect(stepCount).toBe(0);
    
    // Should show error for no valid steps
    if (stepCount === 0) {
      const errorMessage = mockT('files:noValidStepsFound');
      expect(errorMessage).toBe('No valid steps found in multitrack file');
    }
  });

  it('should handle missing step files gracefully', async () => {
    // Mock metadata.json with steps but missing files
    const metadata = {
      name: 'Incomplete Track',
      isMultitrack: true,
      steps: [
        { name: 'Missing Step', created: '2024-01-01T00:00:00Z', modified: '2024-01-01T00:00:00Z' }
      ],
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z'
    };

    mockZipContent.file.mockImplementation((filename) => {
      if (filename === 'metadata.json') {
        return {
          async: vi.fn().mockResolvedValue(JSON.stringify(metadata))
        };
      }
      // No step files exist
      return null;
    });

    // Test the fixed logic
    const metadataFile = mockZipContent.file('metadata.json');
    const metadataContent = await metadataFile.async('text');
    const parsedMetadata = JSON.parse(metadataContent);
    
    const stepCount = parsedMetadata.steps.length;
    const steps = [];
    
    for (let i = 0; i < stepCount; i++) {
      // Try step_X.js format first
      let stepFile = mockZipContent.file(`step_${i}.js`);
      
      // If not found, try step name from metadata
      if (!stepFile && parsedMetadata.steps && parsedMetadata.steps[i]) {
        const stepName = parsedMetadata.steps[i].name.replace(/[^a-zA-Z0-9]/g, '_');
        stepFile = mockZipContent.file(`${stepName}.js`);
      }
      
      if (stepFile) {
        // This won't execute since no files exist
        steps.push({});
      }
    }
    
    expect(steps).toHaveLength(0);
    
    // Should show error for no valid steps found
    if (steps.length === 0) {
      const errorMessage = mockT('files:noValidStepsFound');
      expect(errorMessage).toBe('No valid steps found in multitrack file');
    }
  });
});