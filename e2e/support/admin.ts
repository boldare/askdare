/** Signs visitors in (the host page) and console users (e2e/admin.spec.ts), as the site's backend would. */
export const IDENTITY_SECRET = 'e2e-identity-secret-shared-with-the-host-page';
/** Signs in to the admin console (ADR-0032): different from CHAT_SECRET and IDENTITY_SECRET. */
export const ADMIN_SECRET = 'e2e-admin-secret-different-from-the-others';
/** The one user an identity token may sign in to the console as (`admin.console.allow`). */
export const ADMIN_USER = 'e2e-admin';
/** Vercel Cron's bearer token for the site's sweep route (site/app/api/cron/sweep). */
export const CRON_SECRET = 'e2e-cron-secret-different-from-the-others';
