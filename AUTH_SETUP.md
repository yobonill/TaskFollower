# TaskFollower — Firebase Authentication setup

The application now uses two Firebase Email/Password accounts behind a Spanish username/password screen.

## Configured users

- Yisel UID: `Z0Kf2S6iCvVOYQycexiJoPE6sPG2`
- Yorki UID: `iF4VXsQ31TT12A44grdEvRAni9S2`

The application currently maps the usernames to these internal Firebase emails:

- `yisel@taskfollower.invalid`
- `yorki@taskfollower.invalid`

If the users were created with different emails, edit only `src/config/appUsers.ts`. Do not put passwords in source code.

## Deployment order

1. Keep the current Realtime Database rules temporarily while deploying the authentication update.
2. Build and deploy the app.
3. Test logging in as Yorki and Yisel.
4. In Realtime Database → Rules, paste the contents of `firebase-database-rules.json` and publish.
5. Test task reading and writing with each user.
6. Disable Anonymous under Authentication → Sign-in method.

## Behavior

- The app displays only Yorki/Yisel, never the internal email.
- Firebase keeps the authenticated session on the device.
- First login on a device requires internet.
- An authenticated device can reopen the cached PWA offline.
- `Asignada por` is automatically the logged-in user for new tasks.
- The dashboard filter does not change the logged-in identity.
- Existing tasks are migrated from display names to Firebase UIDs without generating rewards.
