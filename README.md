# baseline-check (blc)
![alt text](image.png)

Lightweight CLI to scan a project for used web platform features and report their Baseline status.

Quick install

Run once without installing:

```powershell
npx baseline-check -- --summary
```

Install locally (dev):

```powershell
npm install --save-dev baseline-check
npx blc -- --summary
```

Install globally:

```powershell
npm install -g baseline-check
blc -- --summary
```

Usage examples

- Default (shows risky items only):
	npm run blc

- Show everything:
	npm run blc -- --all

- Show newly available:
	npm run blc -- --new

- Summary only:
	npm run blc -- --summary

- Scan specific files/globs:
	npm run blc -- src/**/*.css

Flags

- --all       Show all findings
- --new       Show newly available features
- --warnings, -w  Show warnings + newly available
- --summary, -s   Print summary counts and score
- --limit N   Limit printed items per file

Notes

- The package exposes two CLI names: `blc` and `baseline-check`.
- The bin runs Node with `--no-warnings` to suppress experimental JSON import warnings.
- Scanner ignores `node_modules`, `dist`, and `.git` by default.

Testing locally

- Create a tarball to inspect what will be published:

```powershell
npm pack
```

- Or test via link:

```powershell
npm link
# then in your project
npm link baseline-check
baseline-check -- --summary
```

Publishing

- Bump and publish a patch:

```powershell
npm version patch
npm publish --access public
```

License

ISC

