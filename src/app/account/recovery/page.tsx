import { AccountRecovery } from "@/client/account-recovery";
import { safeAccountReturn } from "@/shared/account-navigation";
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AccountRecovery
      initialToken={typeof params.token === "string" ? params.token : ""}
      verify={params.verify === "1"}
      returnTo={safeAccountReturn(
        typeof params.returnTo === "string" ? params.returnTo : "/",
      )}
      invalidLink={Boolean(params.error)}
    />
  );
}
