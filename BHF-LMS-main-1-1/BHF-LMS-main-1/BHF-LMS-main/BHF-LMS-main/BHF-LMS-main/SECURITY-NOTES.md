# Security Notes - localStorage Management

## Overview
This document outlines the security measures implemented to prevent sensitive authentication data from being persisted to localStorage on localhost environments.

## Localhost Storage Prevention

### Implementation
Added localhost detection and safe storage wrapper functions in `script.js`:

1. **`isLocalhost()`** - Detects if running on localhost
   - Returns `true` for: `localhost`, `127.0.0.1`, `::1`
   - Returns `false` for production domains

2. **Safe Storage Wrappers** - All localStorage access now goes through:
   - `safeSetStorage(key, value)` - Sets data only if NOT on localhost
   - `safeGetStorage(key)` - Retrieves data only if NOT on localhost
   - `safeRemoveStorage(key)` - Removes data only if NOT on localhost

### Behavior on Localhost
- **No data is saved** to localStorage when running on `localhost`
- **No data is retrieved** from localStorage when running on `localhost`
- Console warnings logged for visibility: `"Storage disabled on localhost: {key}"`
- Application continues to function normally (data just isn't persisted)

### Behavior on Production
- All localStorage operations work normally
- Data persists across sessions as expected

## Data Stored (Non-Sensitive Only)

The following NON-SENSITIVE user data is stored in localStorage when NOT on localhost:

1. **Theme Preference** (`bhf_theme`)
   - User's selected theme (light/dark)
   - Non-sensitive, public preference

2. **User Snapshot** (`bhf_last_user_snapshot`)
   - `uid`, `email`, `name`, `role`, `photoURL`
   - **NO passwords, NO auth tokens**
   - Metadata only, used for UX optimization

3. **Profile Photos** (`bhf_profile_photo_{uid}`)
   - URLs to profile images
   - Non-sensitive

4. **Enrollments** (`bhf_user_enrollments`)
   - Course enrollment records
   - Non-sensitive application data

5. **Course Access** (`bhf_course_access_payments`)
   - Payment/access records
   - Non-sensitive application data

6. **Admin Content Overrides** (`bhf_admin_content`)
   - Admin page customizations
   - Non-sensitive

## Critical Security Note: Authentication Tokens

**Firebase Authentication tokens are NOT stored in localStorage by our code.**

Firebase SDK handles authentication state internally:
- Tokens are managed by Firebase Auth SDK
- Tokens are cleared on logout via `auth.signOut()`
- Browser session is used for state persistence (not localStorage)

## What is NEVER Stored

The following sensitive data is NEVER stored in localStorage:
- ❌ Passwords
- ❌ Authentication tokens
- ❌ Session tokens
- ❌ API keys (except GEMINI_IMAGE_API_KEY which is embedded for development only)
- ❌ Private credentials

## Affected Storage Functions

All of the following functions now use safe wrappers:

- `getStoredTheme()` / `saveStoredTheme()`
- `getLastUserSnapshot()` / `saveLastUserSnapshot()`
- `getUserContact()` / `saveUserContact()`
- `getStoredProfilePhoto()` / `saveStoredProfilePhoto()`
- `getCertificateTemplate()` / `saveCertificateTemplate()` / `resetCertificateTemplate()`
- `getEnrollments()` / `saveEnrollments()`
- `getCourseAccessPayments()` / `saveCourseAccessPayments()`
- `getContentOverrides()` / `saveContentOverride()` / `clearContentOverride()`

## Testing

### To verify localhost protection:
1. Run the app on `http://localhost:3000`
2. Open DevTools → Application → Storage → LocalStorage
3. Perform actions that normally save data (change theme, log in, etc.)
4. Verify NO new entries appear in localStorage
5. Check console for warnings: `"Storage disabled on localhost: {key}"`

### To test production mode:
1. Deploy to a non-localhost domain
2. Verify localStorage is populated as expected
3. Confirm UX optimizations work (theme persistence, etc.)

## Configuration

To disable localhost protection (not recommended), modify `isLocalhost()` to return `false`.

To expand localhost detection, add more hostnames to the `isLocalhost()` function conditions.

## References

- **Files Modified**: `script.js`
- **Security Focus**: Preventing sensitive data leakage on development machines
- **Implementation Date**: [Current session]
- **Authentication**: Relies on Firebase Auth SDK for secure token management
