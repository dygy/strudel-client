# File Manager Feature Implementation

## What was implemented:

### 1. Left Sidebar File Manager
- **Location**: `website/src/repl/components/sidebar/FileManager.jsx`
- **Features**:
  - Create new tracks with custom names
  - Load existing tracks into the editor
  - Save current code to selected track
  - Delete tracks with confirmation
  - Duplicate tracks
  - Download tracks as `.js` files
  - Import tracks from `.js` or `.txt` files
  - Local storage persistence
  - Visual indication of selected track
  - Sorted by last modified date

### 2. Resizable Sidebar
- **Location**: `website/src/repl/components/sidebar/ResizableSidebar.jsx`
- **Features**:
  - Drag to resize from 200px to 500px width
  - Default width of 300px
  - Visual resize handle
  - Smooth resizing with proper cursor feedback

### 3. Header Updates
- **Removed**: "learn" and "share" buttons as requested
- **Added**: "files" toggle button with hamburger icon
- **Location**: `website/src/repl/components/Header.jsx`

### 4. Settings Integration
- **Added**: `isFileManagerOpen` setting to control sidebar visibility
- **Location**: `website/src/settings.mjs`
- **Functions**: `setIsFileManagerOpen()` to toggle visibility

### 5. Layout Integration
- **Updated**: `ReplEditor.jsx` to include the resizable sidebar
- **Responsive**: Sidebar only shows when not in zen mode
- **Conditional**: Respects the `isFileManagerOpen` setting

## How to use:

### Creating Tracks:
1. Click the "+" button in the file manager header
2. Enter a track name and press Enter or click "Create"
3. The new track will be created and loaded into the editor

### Managing Tracks:
- **Load**: Click on any track in the list to load it
- **Save**: Click the save button (💾) or use the "Save Changes" button at the bottom
- **Download**: Click the download arrow to save as `.js` file
- **Duplicate**: Click the duplicate icon to create a copy
- **Delete**: Click the trash icon (confirms before deleting)

### Import/Export:
- **Import**: Click the import button (rotated download arrow) to load `.js` or `.txt` files
- **Export**: Use the download button on individual tracks

### Sidebar Control:
- **Toggle**: Click the "files" button in the header to show/hide sidebar
- **Resize**: Drag the right edge of the sidebar to resize
- **Persistence**: Sidebar state and width are remembered

## Technical Details:

### Storage:
- Uses `localStorage` with key `strudel_tracks`
- Tracks stored as JSON with metadata (id, name, code, created, modified)
- Automatic saving when tracks are modified

### Integration:
- Integrates with existing REPL context
- Uses `context.handleUpdate()` to load code into editor
- Respects existing settings system
- Compatible with zen mode (hides when zen is active)

### Styling:
- Uses existing Tailwind classes for consistency
- Matches the existing color scheme and design
- Responsive design that works on different screen sizes

## Benefits:
- **Local Development**: Save and organize multiple tracks locally
- **File Management**: Easy import/export of tracks as JavaScript files
- **Workflow**: Streamlined workflow for managing multiple compositions
- **Persistence**: Tracks are saved locally and persist between sessions
- **Clean Interface**: Removed clutter by removing "learn" and "share" buttons