import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

assert.match(
  appSource,
  /className="relative min-h-\[430px\][^"]*md:h-\[calc\(100dvh-4rem\)\][^"]*md:min-h-0"/,
  'ImmersiveProfile hero keeps mobile min-height and uses fixed desktop viewport height below navigation',
);

assert.match(
  appSource,
  /src=\{headerImage\}[\s\S]*?className="absolute inset-0 h-full w-full object-cover"/,
  'ImmersiveProfile header image is absolute and uses object-cover for headerImage and avatar fallback',
);

assert.doesNotMatch(
  appSource,
  /object-contain p-12|md:p-24|blur-\[1px\][^`]*\$\{hasProfileHeaderImage/,
  'ImmersiveProfile avatar fallback no longer uses contain, padding, or fallback blur presentation',
);

assert.match(
  appSource,
  /data-profile-header-swipe-ignore="true"[\s\S]*?<div className="flex min-w-full w-max justify-center gap-2 px-5">[\s\S]*?themes\.map/,
  'Theme pills keep swipe-ignore on the scroll container and use a centered inner row',
);
