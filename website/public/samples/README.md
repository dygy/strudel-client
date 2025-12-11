# Strudel Samples Directory

This directory contains locally stored sample libraries for Strudel.

## VCSL (VSCO Community Sample Library)

The `vcsl/` subdirectory contains samples from the VSCO Community Sample Library.

- **Original Repository**: https://github.com/sgossner/VCSL
- **License**: CC0 (Creative Commons Zero) - Public Domain
- **Total Samples**: ~868 samples (~4GB)

### Download VCSL Samples

To download the VCSL samples locally:

```bash
# Download all samples (recommended)
node scripts/download-vcsl-samples.js download

# Download first 50 samples (for testing)
node scripts/download-vcsl-samples.js download 50

# Check download status
node scripts/download-vcsl-samples.js status
```

### Why Local Storage?

Storing samples locally provides:

1. **Reliability**: No dependency on external repositories
2. **Performance**: Faster loading times
3. **Offline Support**: Works without internet connection
4. **Consistency**: Same samples across all environments

### Directory Structure

```
samples/
├── vcsl/                           # VCSL samples
│   ├── Aerophones/                 # Wind instruments
│   ├── Membranophones/             # Drums and percussion
│   ├── Idiophones/                 # Struck instruments
│   └── ...                        # Other categories
└── README.md                       # This file
```

### Git Ignore

The `samples/` directory is excluded from git (except this README) to avoid:
- Large repository size
- Slow clones
- Storage costs

Each developer should download samples locally using the provided scripts.

### Adding New Sample Libraries

To add new sample libraries:

1. Create a subdirectory in `samples/`
2. Add JSON mapping file in `website/public/`
3. Update `prebake.ts` to load the new library
4. Create download script if needed
5. Update this README

### License Compliance

All sample libraries must have appropriate licenses for use in Strudel:
- CC0 (Public Domain) - Preferred
- CC-BY (Attribution) - Acceptable
- MIT/BSD - Acceptable
- Proprietary - Requires explicit permission

Always include license information and attribution in the sample library documentation.