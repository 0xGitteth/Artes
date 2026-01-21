# Theme Sanitization Test Plan

## Changes Made

### 1. Firebase Functions (src/firebase.js)
- ✅ `sanitizeThemes()` function - removes "General" from themes array
- ✅ `createUserProfile()` - now sanitizes themes before writing to users/{uid}
- ✅ `updateUserProfile()` - now sanitizes themes before writing to users/{uid} AND logs the payload in DEV mode
- ✅ `writePublicUserProfile()` - now sanitizes themes before writing to publicUsers/{uid} AND logs the payload in DEV mode
- ✅ `migrateArtifactsUserData()` - sanitizes themes during migration and logs in DEV mode

### 2. ArtesApp.jsx Changes
- ✅ Removed `sanitizeThemes` from imports (no longer needed in UI layer)
- ✅ Removed local `sanitizeThemes()` call in `handleCompleteProfile()` - now handled centrally
- ✅ All theme defaults remain as `[]` (not `["General"]`)

### 3. Theme Default Values
- Line 213: `const themes = Array.isArray(profileData?.themes) ? profileData.themes : [];`
- Line 1237: `themes: Array.isArray(profile?.themes) ? profile.themes : [],`
- Line 3029: `themes: formData.themes || [],`

All defaults are empty arrays `[]`, never `["General"]`.

## Test Cases

### Test 1: Empty themes on save
1. Open SettingsModal
2. Make sure no themes are selected
3. Click Save
4. Check browser console for DEV logging: `[updateUserProfile] Writing to users/{uid}`
5. Verify payload includes `themes: []`

### Test 2: "General" theme removal (if somehow present)
1. If you have old data with `["General"]`, it should be filtered out
2. Check console for: `[sanitizeThemes] Removed "General" from themes`
3. Verify final payload has empty themes array

### Test 3: Valid themes preservation
1. Select multiple valid themes (e.g., "Abstract", "Portrait")
2. Save
3. Check console for themes array containing selected themes
4. Refresh page
5. Verify themes persist correctly

### Test 4: Profile creation
1. Create new user profile
2. Complete onboarding without selecting themes
3. Check console for: `[createUserProfile] Writing to users/{uid}`
4. Verify users/{uid} has `themes: []`
5. Check publicUsers/{uid} - should also have `themes: []`

### Test 5: Migration check
1. If data migrates from artifacts, check console for:
   - `[migrateArtifactsUserData] Creating users/{uid} from artifacts`
   - Any themes should be sanitized

## DEV Logging Enabled In
- `createUserProfile()` - logs full payload before write
- `updateUserProfile()` - logs sanitized payload before write  
- `writePublicUserProfile()` - logs final payload before write
- `migrateArtifactsUserData()` - logs migration actions
- `sanitizeThemes()` - logs when "General" is removed
- `migrateRemoveGeneralTheme()` - logs cleanup actions

## Expected Behavior After Changes
- ❌ "General" should NEVER be in the database
- ❌ Empty themes should NEVER default to ["General"]
- ✅ Empty themes should always be `[]`
- ✅ Valid themes should be preserved
- ✅ All writes sanitize themes automatically
