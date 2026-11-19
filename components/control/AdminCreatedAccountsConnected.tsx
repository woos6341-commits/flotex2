import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { trpc } from "@/lib/trpc";
import { AdminCreatedAccounts, type AdminCreatedAccountsApi } from "./AdminCreatedAccounts";
import { AdminImmediateAccounts } from "./AdminImmediateAccounts";

export function AdminCreatedAccountsConnected() {
  const [showLegacy, setShowLegacy] = useState(false);
  const utils = trpc.useUtils();
  const { mutateAsync: create } = trpc.adminCreatedAccounts.create.useMutation();
  const { mutateAsync: submit } = trpc.adminCreatedAccounts.submit.useMutation();
  const { mutateAsync: recordIdentity } = trpc.adminCreatedAccounts.recordIdentity.useMutation();
  const { mutateAsync: issueInvitation } = trpc.adminCreatedAccounts.issueInvitation.useMutation();
  const { mutateAsync: suspend } = trpc.adminCreatedAccounts.suspend.useMutation();
  const api = useMemo<AdminCreatedAccountsApi>(() => ({
    list: () => utils.adminCreatedAccounts.list.fetch(),
    create: (input) => create(input),
    submit: (input) => submit(input),
    recordIdentity: (input) => recordIdentity(input),
    issueInvitation: (input) => issueInvitation(input),
    suspend: (input) => suspend(input),
  }), [utils, create, submit, recordIdentity, issueInvitation, suspend]);
  return <View><AdminImmediateAccounts /><Pressable accessibilityRole="button" onPress={() => setShowLegacy(value => !value)} className="my-4 self-end"><Text className="text-sm font-semibold text-[#D7B75E]">{showLegacy ? "إخفاء الطلبات السابقة" : "عرض الطلبات السابقة والدعوات"}</Text></Pressable>{showLegacy ? <AdminCreatedAccounts api={api} invitationsEnabled={false} /> : null}</View>;
}
