import { createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { asc } from 'drizzle-orm';
import { getDb } from '../server/db';
import { transactions,wallets } from '../drizzle/schema';
async function main(){
 const db=await getDb();if(!db)throw Error('Database unavailable');
 const original=await db.select({id:transactions.id,reference:transactions.reference,userId:transactions.userId,type:transactions.type,amount:transactions.amount,currency:transactions.currency,status:transactions.status,note:transactions.note,createdAt:transactions.createdAt}).from(transactions).orderBy(asc(transactions.id));
 const balances=await db.select().from(wallets).orderBy(asc(wallets.id));
 const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const current={transactionsHash:digest(original),walletsHash:digest(balances),transactionCount:original.length,walletCount:balances.length};
 const path='/tmp/atheer-ledger-preservation-snapshot.json';
 if(process.argv[2]==='before'){writeFileSync(path,JSON.stringify(current));console.log('Snapshot saved: counts and hashes only.');}
 else{const before=JSON.parse(readFileSync(path,'utf8'));if(before.transactionsHash!==current.transactionsHash||before.walletsHash!==current.walletsHash)throw Error('Baseline changed: inspect concurrent financial activity');console.log('PASSED: original transaction fields and every wallet row unchanged by migration.');}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1)});
