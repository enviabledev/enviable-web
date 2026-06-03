"use client";

/**
 * Placeholder for /admin/users. The backend has no users controller and
 * no /api/users endpoints; the user.read and user.manage permissions are
 * defined in the seed catalogue but reference capabilities that don't
 * exist yet. See BACKLOG.md ("Admin cluster screens have no backend
 * surface") for the precise findings and recommended backend round.
 *
 * The page replaces a 404 with an honest explanation: the nav link
 * renders for users holding user.read (Managing Director, Executive
 * Director, General Manager), they previously hit 404 on click; now
 * they hit the not-yet-built card.
 *
 * Permission gating: same as the eventual real screen will use
 * (user.read). A user without user.read sees the standard access-denied
 * treatment (no change to that surface). The not-yet-built card is
 * shown ONLY to users who would have access to the eventual real
 * screen, so the message lands with the audience that cares.
 */
import NotYetBuiltCard from "@/components/admin/NotYetBuiltCard";
import { UsersIcon } from "@/components/icons";
import { usePermissions } from "@/lib/auth";

export default function AdminUsersPlaceholderPage() {
  const { has } = usePermissions();
  const canRead = has("user.read");

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to user administration. This screen requires the
            <span className="font-mono mx-1">user.read</span> permission, which is held by
            senior administrative roles (Managing Director, Executive Director, General
            Manager).
          </p>
        </div>
      </div>
    );
  }

  return (
    <NotYetBuiltCard
      title="Users"
      icon={<UsersIcon className="w-[20px] h-[20px] text-[var(--color-ink-500)]" />}
    >
      <p>
        User management is not yet available in the app. Users are currently maintained
        via the seed configuration in the backend, and their credentials are activated
        using the <code>set-password</code> script.
      </p>
      <p>
        In-app user management (creating users, assigning roles, deactivating access)
        requires backend endpoints that have not yet been built. The permissions{" "}
        <code>user.read</code> and <code>user.manage</code> are declared in the seed
        catalogue but reference capabilities that do not exist on the backend yet.
      </p>
      <p>
        If you need user changes in the meantime (a new hire, a role change, deactivating
        a departing staffer), reach out to your engineering contact. They will update the
        seed configuration and run the <code>set-password</code> script as needed.
      </p>
    </NotYetBuiltCard>
  );
}
