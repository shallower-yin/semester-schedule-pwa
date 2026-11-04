# Temporary deepmerge security backport

This is the published `deepmerge@4.3.1` CommonJS bundle plus the narrow
`getKeys` fix proposed in upstream PR #286, commit
`9add7d91abb595703679faf7b7942bbe7f87642b`:
https://github.com/TehShrike/deepmerge/pull/286

The filter skips the string `__proto__` before reading or assigning it in both
the target-copy and source-copy paths, including recursive and array clones.
Ordinary keys, symbols, array handling and the public API are unchanged.
The original MIT license and copyright are preserved in LICENSE.

As of 2026-11-04 the latest registry release is still 4.3.1 and has no published
fix for GHSA-gcqx-w48m-w2h4. This local package is deliberately identified as a
downstream backport, **not** an official patched release. npm audit does not
validate local packages; the installed dependency is covered by executable
prototype-poisoning and compatibility tests in `buildDependencySecurity.test.ts`.

Only `@rollup/plugin-node-resolve` is redirected here. No browser/runtime library
uses this package. Replace the override with a verified upstream release once
available, keeping the behavioral security tests. Do not remove the patch merely
because a dependency scanner reports zero advisories.

The root npm workspace supplies the exact downstream version used by the resolver;
clean `npm ci` must work without relying on an existing node_modules directory.
For a subsequent patch, increment the local version and the root dependency/override
together, regenerate the lockfile, and rerun the safety tests and PWA build.
