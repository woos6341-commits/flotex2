import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function initialize() {
  const db=await getDb();if(!db)throw new Error("قاعدة البيانات غير متاحة");
  await db.execute(sql`INSERT IGNORE INTO app_settings (\`key\`,\`value\`) VALUES ('min_deposit_amount','500.00'),('min_withdrawal_amount','50.00')`);
  await db.execute(sql`INSERT IGNORE INTO payment_methods (id,name) VALUES ('vodafone','Vodafone Cash'),('orange','Orange Cash'),('etisalat','Etisalat Cash'),('instapay','Instapay')`);
  console.log("تم تثبيت الإعدادات الأولية والوسائل الأربع مع الحفاظ على القيم المحفوظة والأرصدة.");
}
initialize().then(()=>process.exit(0)).catch(()=>{console.error("تعذرت تهيئة إعدادات الدفع");process.exit(1);});
