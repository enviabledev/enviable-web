"use client";

/**
 * Placeholder for /admin/roles. Same shape and reasoning as
 * /admin/users: backend has no roles controller, no /api/roles
 * endpoints, role.read / role.manage are seeded but reference
 * unimplemented capabilities. See BACKLOG.md.
 *
 * Permission gating: role.read for the not-yet-built card; users
 * without it see access-denied.
 */
import NotYetBuiltCard from "@/components/admin/NotYetBuiltCard";
import { RolesIcon } from "@/components/icons";
import { usePermissions } from "@/lib/auth";

export default function AdminRolesPlaceholderPage() {
  const { has } = usePermissions();
  const canRead = has("role.read");

  if (!canRead) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to role administration. This screen requires the
            <span className="font-mono mx-1">role.read</span> permission, which is held by
            senior administrative roles (Managing Director, Executive Director, General
            Manager).
          </p>
        </div>
      </div>
    );
  }

  return (
    <NotYetBuiltCard
      title="Roles"
      icon={<RolesIcon className="w-[20px] h-[20px] text-[var(--color-ink-500)]" />}
    >
      <p>
        Role management is not yet available in the app. Roles and their permission grants
        are defined in the backend seed and applied at deploy time. The current role
        catalogue (Managing Director, Executive Director, General Manager, Warehouse
        Manager, Sales Manager, Procurement Officer, Stock Auditor, Internal Auditor /
        Compliance, IT Admin, and the other operational roles) is fixed for this
        deployment.
      </p>
      <p>
        In-app role inspection (viewing what each role can do) and role editing (modifying
        permission grants, creating new roles) require backend endpoints that have not yet
        been built. The permissions <code>role.read</code> and <code>role.manage</code>{" "}
        are declared in the seed catalogue but reference capabilities that do not exist on
        the backend yet.
      </p>
      <p>
        If you need role-catalogue changes, reach out to your engineering contact. They
        will update the seed configuration and redeploy.
      </p>
    </NotYetBuiltCard>
  );
}
