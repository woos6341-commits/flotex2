import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { ActionButton, Card, EmptyState, Pill, formatMoney } from "@/components/atheer-ui";
import { VerifiedName } from "@/components/VerifiedName";
import { trpc } from "@/lib/trpc";
import { CustomerDossier } from "./CustomerDossier";

type Customer = {
  id: number;
  customerId?: string | null;
  name?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  birthDate?: string | null;
  nationalIdMasked?: string | null;
  role?: string | null;
  status?: "active" | "deleted";
  deletedAt?: string | Date | null;
  accountFrozen?: boolean;
  verificationStatus?: string;
};

type CustomerRow = {
  user: Customer;
  wallet: { balance?: string | number | null } | null;
  available?: string | number | null;
};

export function CustomerManagement() {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const customers = trpc.admin.customers.useQuery({ search }, { staleTime: 0, refetchOnWindowFocus: true, retry: false });

  return <View>
    <Text className="mb-1 text-lg font-bold text-[#F7F1E3]">العملاء والبحث والتدقيق</Text>
    <Text className="mb-4 text-xs leading-5 text-[#9BA8B8]" style={{ textAlign: "right" }}>ابحث برقم العميل المكوّن من 10 أرقام أو بالاسم أو البريد أو الهاتف، ثم افتح الملف الشامل والسجل الإداري.</Text>
    <TextInput
      value={search}
      onChangeText={setSearch}
      maxLength={100}
      placeholder="رقم العميل / الاسم / البريد / الهاتف"
      placeholderTextColor="#657286"
      keyboardType="default"
      autoCapitalize="none"
      className="mb-3 rounded-2xl border border-[#273548] bg-[#0B1018] px-4 py-3 text-right text-[#F7F1E3]"
    />
    {customers.isLoading ? <ActivityIndicator color="#D7A948" /> : customers.isError ? (
      <EmptyState title="تعذر تحميل قائمة العملاء" text="تحقق من الاتصال وصلاحية الحساب الإداري ثم أعد المحاولة." />
    ) : customers.data?.length ? customers.data.map(({ user: customer, wallet, available }: CustomerRow) => {
      const open = selectedUser === customer.id;
      return <Card key={customer.id} className="mb-3 border-[#273548]">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <View className="flex-row flex-wrap items-center justify-end gap-2">
              {customer.verificationStatus !== "approved" ? <Pill tone={customer.verificationStatus === "pending" ? "gold" : customer.verificationStatus === "rejected" ? "red" : "muted"}>{customer.verificationStatus === "pending" ? "قيد المراجعة" : customer.verificationStatus === "rejected" ? "مرفوض" : "غير موثّق"}</Pill> : null}
              <VerifiedName name={customer.name || "مستخدم Flotex EGP"} verified={customer.verificationStatus === "approved"} nameClassName="text-right font-bold text-[#F7F1E3]" />
            </View>
            <Text className="mt-2 text-right text-xs text-[#9BA8B8]">{customer.email || "بدون بريد"}</Text>
            <Text className="mt-1 text-right text-xs text-[#D7A948]">رقم العميل: {customer.customerId || "غير مكتمل"}</Text>
            <Text className="mt-1 text-right text-[10px] text-[#657286]">{customer.phoneNumber || "لا يوجد هاتف"} · {customer.status === "deleted" ? "الحساب موقوف" : customer.accountFrozen ? "الحساب مجمّد" : "الحساب نشط"}</Text>
          </View>
          <View className="pl-3">
            <Text className="text-left text-sm font-bold text-[#D7A948]">{formatMoney(wallet?.balance)}</Text>
            <Text className="mt-1 text-left text-[10px] text-[#9BA8B8]">متاح {formatMoney(available)}</Text>
          </View>
        </View>
        <View className="mt-4">
          <ActionButton label={open ? "إغلاق ملف العميل" : "فتح الملف الشامل"} icon={open ? "chevron-up-outline" : "person-circle-outline"} secondary onPress={() => setSelectedUser(open ? null : customer.id)} />
        </View>
        {open ? <CustomerDossier customer={customer} /> : null}
      </Card>;
    }) : <EmptyState title="لا يوجد عملاء مطابقون" text="جرّب البحث برقم العميل أو الاسم أو البريد أو الهاتف." />}
  </View>;
}
