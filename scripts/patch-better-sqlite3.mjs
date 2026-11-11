/**
 * Applies the V8 15.2 / Chromium 152 / External Pointer Sandboxing compatibility
 * patch to better-sqlite3@11.8.1 source code for Electron 44.10.2 (ABI 149).
 *
 * This script is idempotent: running it multiple times will not duplicate changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

function findBetterSqlite3Cpp() {
  const possiblePaths = [
    // Direct pnpm path
    path.resolve(
      'D:/ahmed/node_modules/.pnpm/better-sqlite3@11.8.1/node_modules/better-sqlite3/src/better_sqlite3.cpp',
    ),
  ];

  try {
    const pkgPath = req.resolve('better-sqlite3/package.json', {
      paths: ['D:/ahmed/apps/desktop', 'D:/ahmed'],
    });
    possiblePaths.unshift(path.join(path.dirname(pkgPath), 'src', 'better_sqlite3.cpp'));
  } catch {
    // ignore
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(
    `Could not locate better_sqlite3.cpp in search paths: ${possiblePaths.join(', ')}`,
  );
}

export function patchBetterSqlite3(targetFile = findBetterSqlite3Cpp()) {
  console.log(`[patch-better-sqlite3] Inspecting ${targetFile} ...`);
  const original = fs.readFileSync(targetFile, 'utf8');

  if (original.includes('V8_EXTERNAL_POINTER_TAG_COUNT') && original.includes('CreateExternal')) {
    console.log('[patch-better-sqlite3] Patch is already applied. No modifications needed.');
    return { applied: false, alreadyPatched: true };
  }

  let patched = original;

  // 1. Dual-mode external pointer sandboxing header helpers
  const headerBlock = `
#if defined(V8_EXTERNAL_POINTER_TAG_COUNT)
inline v8::Local<v8::External> CreateExternal(v8::Isolate* isolate, void* ptr) {
	return v8::External::New(isolate, ptr, v8::kExternalPointerTypeTagDefault);
}
inline void* GetExternalValue(v8::Local<v8::External> ext) {
	return ext->Value(v8::kExternalPointerTypeTagDefault);
}
#else
inline v8::Local<v8::External> CreateExternal(v8::Isolate* isolate, void* ptr) {
	return v8::External::New(isolate, ptr);
}
inline void* GetExternalValue(v8::Local<v8::External> ext) {
	return ext->Value();
}
#endif
`;

  patched = patched.replace(
    '#include "better_sqlite3.hpp"',
    '#include "better_sqlite3.hpp"\n' + headerBlock,
  );

  // 2. SetNativeDataProperty nullptr instead of 0
  patched = patched.replace(
    /recv->InstanceTemplate\(\)->SetNativeDataProperty\(\s*InternalizedFromLatin1\(isolate,\s*name\),\s*func,\s*0,\s*data\s*\);/g,
    `recv->InstanceTemplate()->SetNativeDataProperty(\n\t\tInternalizedFromLatin1(isolate, name),\n\t\tfunc,\n\t\tnullptr,\n\t\tdata\n\t);`,
  );

  // 3. Addon initialization CreateExternal
  patched = patched.replace(
    /v8::Local<v8::External>\s+data\s*=\s*v8::External::New\(isolate,\s*addon\);/g,
    'v8::Local<v8::External> data = CreateExternal(isolate, addon);',
  );

  // 4. External Value unwrapping with sandboxing tags
  patched = patched.replace(
    /static_cast\s*<\s*Addon\s*\*\s*>\s*\(\s*\(\s*info\s*\.\s*Data\s*\(\s*\)\s*\.\s*As\s*<\s*v8\s*::\s*External\s*>\s*\(\s*\)\s*\)\s*->\s*Value\s*\(\s*\)\s*\)/g,
    'static_cast < Addon * > ( GetExternalValue(info . Data ( ) . As < v8 :: External > ( )) )',
  );

  // 5. Replace info.This() with info.Holder() in PropertyCallbackInfo getters
  patched = patched.replace(
    /node\s*::\s*ObjectWrap\s*::\s*Unwrap\s*<Database>\(info\.This\(\)\)->open/g,
    'node :: ObjectWrap :: Unwrap <Database>(info.Holder())->open',
  );
  patched = patched.replace(
    /node\s*::\s*ObjectWrap\s*::\s*Unwrap\s*<Database>\(info\.This\(\)\);/g,
    'node :: ObjectWrap :: Unwrap <Database>(info.Holder());',
  );
  patched = patched.replace(
    /node\s*::\s*ObjectWrap\s*::\s*Unwrap\s*<Statement>\(info\.This\(\)\);/g,
    'node :: ObjectWrap :: Unwrap <Statement>(info.Holder());',
  );

  fs.writeFileSync(targetFile, patched, 'utf8');
  console.log('[patch-better-sqlite3] Successfully applied V8 15.2 pointer sandboxing patch.');
  return { applied: true, alreadyPatched: false };
}

if (process.argv[1] && process.argv[1].endsWith('patch-better-sqlite3.mjs')) {
  try {
    patchBetterSqlite3();
  } catch (err) {
    console.error(`[patch-better-sqlite3] Failed: ${err.message}`);
    process.exit(1);
  }
}
