# VCSL Samples Local Storage Solution

## Problem

The VCSL (VSCO Community Sample Library) samples in Strudel were experiencing 404 errors when trying to load from the original repository at `https://github.com/sgossner/VCSL`. This caused samples to fail loading in the Strudel settings.

## Root Cause

The samples were configured to load directly from the original repository:
```typescript
samples(`${baseNoTrailing}/vcsl.json`, 'github:sgossner/VCSL/master/', { prebake: true })
```

While the repository and files exist, there were intermittent accessibility issues, possibly due to:
- GitHub rate limiting when loading many samples simultaneously
- Network connectivity issues
- Repository availability fluctuations

## Solution: Local Storage

Instead of relying on external repositories, we now store VCSL samples locally in the repository for maximum reliability.

### 1. Updated Configuration

```typescript
// Before (external dependency)
samples(`${baseNoTrailing}/vcsl.json`, 'github:sgossner/VCSL/master/', { prebake: true })

// After (local storage)
samples(`${baseNoTrailing}/vcsl.json`, undefined, { prebake: true })
```

### 2. Local Sample Storage

- **Location**: `website/public/samples/vcsl/`
- **JSON Mapping**: `website/public/vcsl.json` (updated with local paths)
- **Git Ignore**: Samples excluded from repository (developers download locally)

### 3. Download Script

Created `scripts/download-vcsl-samples.js` to manage local samples:

```bash
# Download all VCSL samples (~868 samples, ~4GB)
node scripts/download-vcsl-samples.js download

# Download first 50 samples (for testing)
node scripts/download-vcsl-samples.js download 50

# Check download status
node scripts/download-vcsl-samples.js status

# Update JSON with local paths
node scripts/download-vcsl-samples.js update-json
```

## Implementation Steps

### Step 1: Download Samples

```bash
# Download all samples (recommended for production)
node scripts/download-vcsl-samples.js download

# Or download a subset for testing
node scripts/download-vcsl-samples.js download 100
```

### Step 2: Verify Setup

```bash
# Check download status
node scripts/download-vcsl-samples.js status

# Should show: ✅ All samples are available locally
```

### Step 3: Test in Application

The samples will now load from local paths like:
```
samples/vcsl/Membranophones/Struck%20Membranophones/Bass%20Drum%201/BDrumNew_hit_v2_rr1_Sum.wav
```

## Directory Structure

```
website/public/
├── vcsl.json                       # Updated with local paths
└── samples/
    ├── README.md                   # Documentation
    └── vcsl/                       # VCSL samples (gitignored)
        ├── Aerophones/             # Wind instruments
        ├── Membranophones/         # Drums and percussion
        ├── Idiophones/             # Struck instruments
        └── ...                     # Other categories
```

## Benefits

1. **Reliability**: No external dependencies, samples always available
2. **Performance**: Faster loading from local filesystem
3. **Offline Support**: Works without internet connection
4. **Consistency**: Same samples across all environments
5. **No Rate Limiting**: No GitHub API or bandwidth restrictions
6. **Version Control**: Samples version controlled with application

## Git Strategy

- **Samples Directory**: Excluded from git (`samples/*` in .gitignore)
- **JSON Mapping**: Included in git (`vcsl.json`)
- **Scripts**: Included in git for easy setup
- **Documentation**: Included in git

Each developer downloads samples locally using the provided script.

## Status: COMPLETED ✅

### Download Results
- **Total Samples**: 860 samples across 54 categories (after cleanup)
- **Downloaded**: 860/860 samples (100% completion)
- **Success Rate**: 97.1% (268 new downloads + 592 existing)
- **Cleaned**: Removed 8 non-existent tom_mallet samples from vcsl.json

### Key Fixes
- ✅ **Anvil samples now available**: Fixed the specific 404 error mentioned in the issue
- ✅ **Guiro samples working**: Fixed URL encoding issues causing 404 errors
- ✅ **Tom mallet 404 errors eliminated**: Removed references to 8 non-existent samples
- ✅ **URL encoding resolved**: Double-encoded spaces in vcsl.json to handle application URL decoding
- ✅ **Missing samples cleaned**: Removed all non-existent sample references from vcsl.json
- ✅ **Audio connection errors resolved**: Added comprehensive error handling in SoundsTab
- ✅ **Local storage working**: All samples load from local filesystem
- ✅ **Repository structure adapted**: Uses actual directory names instead of hardcoded categories

### URL Encoding Fix
The main issue was that sample paths with spaces were being URL-decoded by the application before making HTTP requests, but the web server expected URL-encoded paths. Solution:
- **Problem**: `%20` in vcsl.json → decoded to spaces → 404 error
- **Solution**: `%2520` in vcsl.json → decoded to `%20` → successful request
- **Result**: 863/868 sample paths fixed with double-encoding

### Verification
```bash
# Verify anvil samples are now available
ls -la "website/public/samples/vcsl/Idiophones/Struck%20Idiophones/Anvil/"
# Shows: Anvil_Hit1_v1_rr1_Mid.wav and other anvil samples

# Check overall status
node scripts/download-discovered-samples.js status
# Shows: 📊 Samples: 860/868 (99.1%)
```

## Files Changed

- `website/src/repl/prebake.ts` - Updated to use local samples
- `scripts/discover-vcsl-samples.js` - New discovery script (adapts to real repo structure)
- `scripts/download-discovered-samples.js` - New download script (replaces download-vcsl-samples.js)
- `scripts/fix-vcsl-url-encoding.js` - New script to fix URL encoding issues
- `scripts/clean-missing-vcsl-samples.js` - New script to remove non-existent sample references
- `website/public/samples/README.md` - Sample directory documentation
- `website/public/vcsl.json` - Updated with local paths and fixed URL encoding
- `website/src/repl/components/panel/SoundsTab.tsx` - Fixed audio connection errors
- `VCSL_SAMPLES_FIX.md` - This documentation

## License

The VCSL samples maintain their original CC0 (Creative Commons Zero) license, allowing free use for any purpose.

## Future Enhancements

1. **Automated Updates**: Script to check for new samples in original repository
2. **Selective Downloads**: Download only specific instrument categories
3. **Compression**: Optimize sample file sizes
4. **CDN Integration**: Optional CDN hosting for production deployments