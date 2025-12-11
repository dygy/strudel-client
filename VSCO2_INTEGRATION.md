# VSCO-2-CE Integration Guide

## About VSCO-2-CE

**VSCO-2-CE (VS Chamber Orchestra Community Edition)** is a high-quality, open-source orchestral sample library created by Sam Gossner & Simon Dalzell. It provides professional orchestral sounds for free.

### Features
- 🎻 **Complete Orchestra**: Strings, Brass, Woodwinds, Percussion
- 🆓 **Free & Open Source**: No licensing fees or restrictions
- 🎵 **High Quality**: Professional recordings and sample cutting
- 📄 **Well Documented**: Comprehensive SFZ format support

## Integration Status

### Current Status
- ✅ **Scripts Created**: Download and processing scripts ready
- ✅ **Prebake Integration**: Added to Strudel's sample loading system
- ✅ **JSON Structure**: vsco2.json template created
- ⏳ **Manual Download Required**: Samples need to be downloaded manually

### Why Manual Download?
- GitHub API rate limits prevent automated discovery
- Large file sizes (orchestral samples are typically 100MB+)
- Release-based distribution works better for large sample libraries

## Installation Instructions

### Step 1: Get Information
```bash
node scripts/download-vsco2-release.js info
```

This shows:
- Release information and download URL
- Expected instruments and categories
- Installation instructions

### Step 2: Download VSCO-2-CE
1. Visit: https://github.com/sgossner/VSCO-2-CE/releases/tag/1.1.0
2. Download the **SFZ version** (recommended)
3. Extract the downloaded archive

### Step 3: Install Samples
```bash
# Create the samples directory
mkdir -p website/public/samples/vsco2

# Extract/copy the VSCO-2-CE samples to:
# website/public/samples/vsco2/
```

### Step 4: Process Samples
```bash
node scripts/download-vsco2-release.js process
```

This will:
- Scan the samples directory
- Create category mappings
- Generate `website/public/vsco2.json`
- Organize samples for Strudel

### Step 5: Verify Installation
```bash
node scripts/download-vsco2-release.js status
```

## Expected Sample Categories

After processing, you should see categories like:

### Strings
- `violin_sustain`, `violin_staccato`, `violin_pizzicato`
- `viola_sustain`, `viola_staccato`, `viola_pizzicato`
- `cello_sustain`, `cello_staccato`, `cello_pizzicato`
- `doublebass_sustain`, `doublebass_staccato`, `doublebass_pizzicato`

### Brass
- `trumpet_sustain`, `trumpet_staccato`
- `horn_sustain`, `horn_staccato`
- `trombone_sustain`, `trombone_staccato`
- `tuba_sustain`, `tuba_staccato`

### Woodwinds
- `flute_sustain`, `flute_staccato`
- `oboe_sustain`, `oboe_staccato`
- `clarinet_sustain`, `clarinet_staccato`
- `bassoon_sustain`, `bassoon_staccato`

### Percussion
- `timpani`, `snare`, `cymbals`, `triangle`, etc.

## Usage in Strudel

Once installed, use VSCO-2-CE samples in your patterns:

```javascript
// String sections
s("violin_sustain").n("0 2 4 7")
s("cello_sustain").n("0 1 2 3").slow(2)

// Brass fanfare
s("trumpet_staccato").n("0 2 4").fast(2)
s("horn_sustain").n("0 1").slow(4)

// Woodwind melodies
s("flute_sustain").n("0 2 4 5 7").slow(2)
s("clarinet_staccato").n("0 1 2 3")

// Orchestral percussion
s("timpani").n("0 1 2").slow(2)
```

## File Structure

```
website/public/
├── vsco2.json                    # Sample mappings (generated)
└── samples/
    └── vsco2/                    # VSCO-2-CE samples (manual download)
        ├── Strings/
        │   ├── Violin/
        │   ├── Viola/
        │   ├── Cello/
        │   └── DoubleBass/
        ├── Brass/
        │   ├── Trumpet/
        │   ├── Horn/
        │   ├── Trombone/
        │   └── Tuba/
        ├── Woodwinds/
        │   ├── Flute/
        │   ├── Oboe/
        │   ├── Clarinet/
        │   └── Bassoon/
        └── Percussion/
            └── [various percussion instruments]
```

## Integration with Strudel

### Prebake Configuration
VSCO-2-CE is integrated into Strudel's prebake system:

```typescript
// In website/src/repl/prebake.ts
samples(`${baseNoTrailing}/vsco2.json`, undefined, { 
  prebake: true, 
  tag: 'orchestral' 
});
```

### Sample Categories
- **Tag**: `orchestral` - Groups all VSCO-2-CE samples
- **Categories**: Organized by instrument and articulation
- **Naming**: Consistent `instrument_articulation` format

## Troubleshooting

### Common Issues

**1. Samples not loading**
- Check that samples are in `website/public/samples/vsco2/`
- Verify `vsco2.json` was generated correctly
- Restart development server after installation

**2. Empty categories**
- Ensure samples were extracted to the correct directory
- Run the process command again
- Check file permissions

**3. Missing instruments**
- Different VSCO-2-CE versions may have different instruments
- Check the actual downloaded content
- Update category mappings if needed

### Verification Commands
```bash
# Check integration status
node scripts/download-vsco2-release.js status

# List sample files
find website/public/samples/vsco2 -name "*.wav" | wc -l

# Check JSON structure
cat website/public/vsco2.json | jq 'keys'
```

## Benefits for Strudel

### Enhanced Musical Capabilities
- **Orchestral Compositions**: Create full orchestral arrangements
- **Realistic Instruments**: High-quality recorded instruments
- **Articulation Variety**: Multiple playing techniques per instrument
- **Professional Sound**: Studio-quality samples

### Educational Value
- **Learn Orchestration**: Experiment with real orchestral instruments
- **Composition Practice**: Write for traditional orchestra
- **Sound Design**: Layer orchestral elements with electronic sounds

## License & Credits

### VSCO-2-CE License
- **Open Source**: Free to use for any purpose
- **No Restrictions**: Commercial and non-commercial use allowed
- **Attribution**: Credit to creators appreciated but not required

### Credits
- **Recording**: Sam Gossner & Simon Dalzell
- **Sample Cutting**: Elan Hickler/Soundemote
- **Project**: Versilian Studios
- **Integration**: Strudel community

## Future Enhancements

### Potential Improvements
1. **Automatic Download**: Implement direct download from releases
2. **Selective Installation**: Choose specific instrument families
3. **Multiple Articulations**: Support for extended techniques
4. **Dynamic Loading**: Load samples on-demand to reduce memory usage

### Community Contributions
- Report issues with specific instruments
- Suggest category naming improvements
- Share orchestral composition examples
- Contribute additional orchestral libraries

---

**Ready to add professional orchestral sounds to Strudel!** 🎼