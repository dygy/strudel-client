# Migration from Monorepo to NPM Dependencies

## What was changed:

### 1. Removed monorepo configuration:
- Deleted `pnpm-workspace.yaml`
- Deleted `lerna.json`
- Changed main package name from `@strudel/monorepo` to `strudel-app`

### 2. Replaced all `workspace:*` dependencies with npm versions:

#### Main packages (published to npm):
- `@strudel/core`: ^1.2.4
- `@strudel/mini`: ^1.2.4
- `@strudel/tonal`: ^1.2.4
- `@strudel/transpiler`: ^1.2.4
- `@strudel/webaudio`: ^1.2.5
- `@strudel/xen`: ^1.2.4
- `@strudel/draw`: ^1.2.4
- `@strudel/codemirror`: ^1.2.5
- `@strudel/hydra`: ^1.2.4
- `@strudel/midi`: ^1.2.5
- `@strudel/soundfonts`: ^1.2.5
- `@strudel/csound`: ^1.2.5
- `@strudel/gamepad`: ^1.2.4
- `@strudel/motion`: ^1.2.4
- `@strudel/mqtt`: ^1.2.4
- `@strudel/osc`: ^1.2.10
- `@strudel/serial`: ^1.2.4
- `@strudel/web`: ^1.2.5
- `@strudel/mondo`: ^1.1.4
- `superdough`: ^1.2.5
- `mondolang`: ^1.1.1
- `vite-plugin-bundle-audioworklet`: ^0.1.1

#### Packages removed (not published or private):
- `supradough` - not published to npm
- `hs2js` - marked as private
- `@strudel/desktopbridge` - marked as private

### 3. Updated all package.json files:
- Root package.json
- All packages/* directories
- All examples/* directories  
- Website package.json

## Next steps:

### 1. Install dependencies:
```bash
npm install
# or
pnpm install
```

### 2. Handle unpublished packages:
If you need the removed packages (`supradough`, `hs2js`, `@strudel/desktopbridge`), you have these options:
- Publish them to npm first
- Keep them as local packages in a separate structure
- Remove dependencies on them entirely

### 3. Test the migration:
- Run `npm run test` to ensure everything still works
- Run `npm run build` to verify builds work
- Test examples to ensure they work with npm dependencies

### 4. Clean up (optional):
- Consider removing the `packages/` directory if no longer needed
- Update documentation to reflect the new structure
- Update CI/CD pipelines if they relied on the monorepo structure

## Benefits of this migration:
- Simpler dependency management
- No need for workspace-specific tooling
- Each package can be developed independently
- Easier for contributors to understand the structure
- Standard npm dependency resolution