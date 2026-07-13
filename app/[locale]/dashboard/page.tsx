import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { getCurrentUserContext } from "@/lib/server-user";
import { isSupportedLocale, t as translate, type Locale } from "@/lib/i18n";

// Task 3.3: dashboard server component (RSC). Reads the pw_at JWT cookie
// directly (the /{locale}/dashboard route is excluded from middleware JWT
// gating, so no x-user-id header is forwarded here). On any auth failure
// (missing cookie / invalid JWT / unknown user) it redirects to the locale
// login page. Inherits force-dynamic from the [locale] layout.
// Read PI_WEB_JWT_SECRET at module load; throw if missing so a missing
// secret is caught at boot, never silently allowing forged tokens.
function loadSecret(): Uint8Array {
  const secret = process.env.PI_WEB_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "PI_WEB_JWT_SECRET is not set. Configure a strong random secret in the environment."
    );
  }
  return new TextEncoder().encode(secret);
}

const SECRET = loadSecret();

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    redirect("/en/login");
  }
  // Use lib/i18n.ts::t() instead of next-intl/server getTranslations.
  // The fork has no i18n/request.ts config, so next-intl server-side
  // translation calls would throw at runtime. Our t() helper reads
  // messages/{locale}.json directly via lib/i18n.ts.
  const tr = (key: string) => translate(`dashboard.${key}`, locale as Locale);

  // Read cookie
  const cookieStore = await cookies();
  const token = cookieStore.get("pw_at")?.value;

  if (!token) {
    redirect(`/${locale}/login`);
  }

  // Verify JWT
  let userId: string;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    userId = String(payload.sub);
  } catch {
    redirect(`/${locale}/login`);
  }

  // Load user context
  const ctx = await getCurrentUserContext(userId);
  if (!ctx) {
    redirect(`/${locale}/login`);
  }

  // Load projects for user's teams
  const projects = await prisma.project.findMany({
    where: { teamId: { in: ctx.teamIds } },
    orderBy: { createdAt: "desc" },
  });

  // Render
  return (
    <div className="max-w-2xl mx-auto mt-10 p-6">
      <h1 className="text-3xl mb-4">{tr("title")}</h1>
      <p className="text-lg mb-2">
        {tr("welcome")
          .replace("{username}", ctx.user.username)
          .replace("{role}", ctx.role ?? "—")}
      </p>
      <p className="mb-4">
        {tr("mustChangePassword")}: {String(ctx.mustChangePassword)}
      </p>

      <h2 className="text-xl mt-6 mb-2">{tr("projects")}</h2>
      {projects.length === 0 ? (
        <p className="text-gray-500">{tr("noProjects")}</p>
      ) : (
        <ul className="list-disc pl-6">
          {projects.map((p) => (
            <li key={p.id}>
              {p.name} ({p.rootPath})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
