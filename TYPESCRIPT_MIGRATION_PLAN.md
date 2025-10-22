# TypeScript Migration Plan for Strudel

## Overview
This document outlines a step-by-step approach to migrate the Strudel project from JavaScript to TypeScript while maintaining functionality and minimizing disruption.

## Phase 1: Infrastructure Setup ✅

### Step 1.1: Install TypeScript Dependencies ✅
- [x] Add `typescript` to devDependencies
- [x] Verify existing type packages (`@types/react`, `@types/react-dom`, `@types/node`)

### Step 1.2: Configure TypeScript ✅
- [x] Update `tsconfig.json` with migration-friendly settings
- [x] Enable `allowJs: true` for gradual migration
- [x] Set `strict: false` initially, will tighten later
- [x] Configure path mappings for `@components/*` and `@src/*`

### Step 1.3: Create Type Definitions ✅
- [x] Create `src/types/strudel.d.ts` for Strudel package types
- [x] Define common interfaces (Hap, HapValue, TriggerFunction)
- [x] Add type declarations for `@strudel/webaudio`, `@strudel/core`, etc.

## Phase 2: File-by-File Migration Strategy

### Priority Order (Recommended):
1. **Utility files** (lowest risk, high impact)
2. **Type definitions and interfaces**
3. **Components with minimal dependencies**
4. **Core REPL functionality**
5. **Complex components with many dependencies**

### Step 2.1: Start with Utility Files
```bash
# Convert these files first:
src/cx.mjs → src/cx.ts
src/useEvent.mjs → src/useEvent.ts
src/useFrame.mjs → src/useFrame.ts
src/useClient.mjs → src/useClient.ts
```

### Step 2.2: Convert Settings and Configuration
```bash
src/settings.mjs → src/settings.ts
src/config.ts (already TypeScript)
```

### Step 2.3: Convert Simple Components
```bash
src/components/Box.astro → (keep as Astro)
src/components/Youtube.jsx → src/components/Youtube.tsx
src/components/Claviature.jsx → src/components/Claviature.tsx
src/components/PitchSlider.jsx → src/components/PitchSlider.tsx
```

### Step 2.4: Convert REPL Utilities
```bash
src/repl/util.mjs → src/repl/util.ts
src/repl/idbutils.mjs → src/repl/idbutils.ts
src/repl/files.mjs → src/repl/files.ts
src/repl/prebake.mjs → src/repl/prebake.ts
```

### Step 2.5: Convert Core REPL Components
```bash
src/repl/components/sidebar/FileManager.jsx → src/repl/components/sidebar/FileManager.tsx
src/repl/components/sidebar/ResizableSidebar.jsx → src/repl/components/sidebar/ResizableSidebar.tsx
src/repl/useReplContext.jsx → src/repl/useReplContext.tsx
src/repl/Repl.jsx → src/repl/Repl.tsx
```

## Phase 3: Gradual Type Safety Improvement

### Step 3.1: Add Basic Types
- Add return types to functions
- Type function parameters
- Add interface definitions for common objects

### Step 3.2: Enable Stricter Checking
```json
// Gradually enable in tsconfig.json:
"noImplicitAny": true,
"strictNullChecks": true,
"strictFunctionTypes": true
```

### Step 3.3: Add Generic Types
- Type React components with proper Props interfaces
- Add generic types for Pattern and Hap objects
- Type audio context and web audio APIs

## Phase 4: Advanced TypeScript Features

### Step 4.1: Create Proper Interfaces
```typescript
// Example interfaces to create:
interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
}

interface ReplContext {
  started: boolean;
  pending: boolean;
  isDirty: boolean;
  activeCode: string;
  error?: Error;
  handleTogglePlay: () => void;
  handleUpdate: (patternData: any, reset?: boolean) => void;
  handleEvaluate: () => void;
  editorRef: React.RefObject<any>;
  containerRef: React.RefObject<HTMLElement>;
}
```

### Step 4.2: Type Strudel-Specific Objects
```typescript
interface Pattern {
  // Define Pattern methods and properties
}

interface StrudelMirror {
  code: string;
  repl: any;
  setCode(code: string): void;
  evaluate(): void;
  toggle(): void;
  updateSettings(settings: any): void;
}
```

## Migration Commands

### For Each File Migration:
```bash
# 1. Rename file
mv src/path/file.mjs src/path/file.ts
# or for React components:
mv src/path/Component.jsx src/path/Component.tsx

# 2. Update imports in other files
# 3. Add type annotations
# 4. Fix any TypeScript errors
# 5. Test functionality
```

## Testing Strategy

### After Each Phase:
1. **Build Check**: `npm run build` should succeed
2. **Type Check**: `npx tsc --noEmit` should pass
3. **Runtime Test**: Development server should start and work
4. **Feature Test**: All existing functionality should work

### Rollback Plan:
- Keep git commits small and focused
- Each file conversion should be a separate commit
- If issues arise, can revert individual file conversions

## Benefits of This Approach

### ✅ **Gradual Migration**
- No "big bang" conversion
- Can pause/resume at any time
- Maintains working codebase throughout

### ✅ **Risk Mitigation**
- Start with low-risk utility files
- Test after each conversion
- Easy to rollback individual changes

### ✅ **Developer Experience**
- Better IDE support and autocomplete
- Catch errors at compile time
- Improved code documentation through types

### ✅ **Maintainability**
- Self-documenting code through type annotations
- Easier refactoring with type safety
- Better collaboration with clear interfaces

## Next Steps

1. **Install dependencies**: `pnpm install` (to get TypeScript)
2. **Start with Phase 2.1**: Convert utility files first
3. **Test thoroughly**: After each file conversion
4. **Iterate**: Move through phases systematically

Would you like me to start with Phase 2.1 and convert the first utility files?