Build scripts
=============

This directory contains helper build scripts used by maintainers.

build_air_gapped_package.ts
---------------------------
Generates an air-gapped package containing `catalog.json` and downloaded schemas.

Run with Node 18+ (uses global fetch):

```bash
# from repository root
node --input-type=module scripts/build_air_gapped_package.ts
```

Or using ts-node (if installed):

```bash
npx ts-node-esm scripts/build_air_gapped_package.ts
```
