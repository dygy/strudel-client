# Design Document - Strudel IDE Features

## Overview

This design extends the existing Strudel IDE features specification to include automatic code formatting with Prettier. The feature integrates Prettier formatting into the CodeMirror editor, providing users with consistent code styling that activates on save and autosave events. The implementation leverages the existing settings system and editor infrastructure while adding new formatting capabilities.

## Architecture

The prettier formatting feature follows Strudel's modular architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Settings UI   │────│  Settings Store  │────│ Editor Manager  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Prettier Config │────│ Format Service   │────│ CodeMirror Ext  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │ Save/Autosave   │
                       │   Handlers      │
                       └─────────────────┘
```

### Key Components:

1. **Settings Integration**: Extends existing settings system with prettier toggle
2. **Format Service**: Core formatting logic using Prettier API
3. **CodeMirror Extension**: Integrates formatting into editor lifecycle
4. **Save Handlers**: Triggers formatting on save/autosave events

## Components and Interfaces

### Settings Extension

```typescript
interface Settings {
  // ... existing settings
  isPrettierEnabled: boolean;
}

interface RawSettings {
  // ... existing settings  
  isPrettierEnabled: boolean | string;
}
```

### Format Service

```typescript
interface FormatService {
  formatCode(code: string, options?: PrettierOptions): Promise<string>;
  isEnabled(): boolean;
  getConfig(): PrettierConfig;
}

interface PrettierConfig {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  semi: boolean;
  singleQuote: boolean;
  trailingComma: 'none' | 'es5' | 'all';
  bracketSpacing: boolean;
  arrowParens: 'avoid' | 'always';
}
```

### CodeMirror Integration

```typescript
interface FormatterExtension {
  formatOnSave: Extension;
  formatOnAutosave: Extension;
  formatCommand: Command;
}
```

## Data Models

### Settings Model

The prettier setting integrates into the existing settings system:

```typescript
const defaultSettings = {
  // ... existing defaults
  isPrettierEnabled: false, // Conservative default
};

const extensions = {
  // ... existing extensions
  isPrettierEnabled: (enabled) => enabled ? formatOnSaveExtension : [],
};
```

### Format Configuration

Uses Strudel's existing prettier configuration from `.prettierrc`:

```json
{
  "printWidth": 120,
  "useTabs": false,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Save formatting consistency
*For any* valid JavaScript code, when prettier is enabled and save is triggered, the formatted output should be consistent across multiple save operations
**Validates: Requirements 8.1**

### Property 2: Autosave formatting consistency  
*For any* valid JavaScript code, when prettier and autosave are both enabled, the formatted output should be identical to manual save formatting
**Validates: Requirements 8.2**

### Property 3: Formatting rule compliance
*For any* code input, when prettier formatting is applied, the output should comply with all configured formatting rules (indentation, spacing, quotes, line length)
**Validates: Requirements 8.3**

### Property 4: Semantic preservation
*For any* syntactically valid JavaScript code, formatting should produce code that has identical AST structure and execution behavior
**Validates: Requirements 8.4**

### Property 5: Setting toggle functionality
*For any* setting state, toggling prettier on/off should correctly enable/disable formatting behavior and persist the setting
**Validates: Requirements 8.5**

### Property 6: Autosave integration consistency
*For any* code changes, when both prettier and autosave are enabled, autosave should trigger formatting with the same result as manual save
**Validates: Requirements 8.6**

### Property 7: Strudel syntax preservation
*For any* valid Strudel pattern code, prettier formatting should preserve Strudel-specific syntax and functionality
**Validates: Requirements 8.7**

## Error Handling

### Format Errors

```typescript
interface FormatError {
  type: 'syntax' | 'config' | 'network';
  message: string;
  line?: number;
  column?: number;
}
```

Error handling strategy:
- **Syntax Errors**: Show user-friendly error message, don't format
- **Config Errors**: Fall back to default config, log warning
- **Network Errors**: Skip formatting, show notification
- **Timeout**: Cancel formatting after 5 seconds

### Graceful Degradation

- If Prettier fails to load: Disable formatting, show warning
- If formatting takes too long: Cancel and continue without formatting
- If formatted code is invalid: Revert to original code

## Testing Strategy

### Unit Testing

Unit tests will cover:
- Format service initialization and configuration
- Settings integration and persistence
- Error handling for various failure modes
- CodeMirror extension registration and lifecycle

### Property-Based Testing

Property-based tests will verify:
- **Formatting Consistency**: Multiple applications of formatting produce identical results
- **Semantic Preservation**: Formatted code maintains identical behavior
- **Rule Compliance**: All formatting rules are consistently applied
- **Integration Behavior**: Save and autosave trigger formatting correctly

### Integration Testing

Integration tests will verify:
- End-to-end formatting workflow from settings to editor
- Interaction with existing autosave functionality
- Compatibility with different CodeMirror configurations
- Performance under various code sizes and complexity

## Implementation Notes

### Prettier Integration

- Use Prettier's browser-compatible build
- Load Prettier asynchronously to avoid blocking editor initialization
- Cache formatted results for performance
- Respect existing `.prettierrc` configuration

### Performance Considerations

- Debounce formatting operations to avoid excessive processing
- Use web workers for large files (>10KB)
- Implement formatting timeout (5 seconds max)
- Cache formatting results for unchanged code

### Browser Compatibility

- Support modern browsers with ES2020+ features
- Graceful degradation for older browsers
- Progressive enhancement approach

### Accessibility

- Ensure formatting doesn't interfere with screen readers
- Maintain cursor position after formatting
- Provide keyboard shortcuts for manual formatting